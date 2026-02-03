/**
 * Backend manager for Ralph Loops Management System.
 * Manages multiple workspace-specific backend connections.
 * 
 * Each workspace can have its own server settings and connection,
 * allowing parallel operation of loops across different workspaces.
 */

import { OpenCodeBackend } from "../backends/opencode";
import type { BackendConnectionConfig, Backend } from "../backends/types";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import { getWorkspace } from "../persistence/workspaces";
import {
  getDefaultServerSettings,
  type ConnectionStatus,
  type ServerSettings,
} from "../types/settings";
import { loopEventEmitter } from "./event-emitter";
import type { LoopEvent } from "../types/events";
import type { CommandExecutor } from "./command-executor";
import { CommandExecutorImpl } from "./remote-command-executor";
import { GitService } from "./git-service";
import { log } from "./logger";

/**
 * Factory function type for creating command executors.
 */
export type CommandExecutorFactory = (directory: string) => CommandExecutor;

/**
 * Server status events.
 * These are emitted via the global event emitter.
 */
export interface ServerConnectedEvent {
  type: "server.connected";
  workspaceId?: string;
  mode: "spawn" | "connect";
  serverUrl?: string;
  timestamp: string;
}

export interface ServerDisconnectedEvent {
  type: "server.disconnected";
  workspaceId?: string;
  timestamp: string;
}

export interface ServerErrorEvent {
  type: "server.error";
  workspaceId?: string;
  error: string;
  timestamp: string;
}

export interface ServerResetEvent {
  type: "server.reset";
  workspaceId?: string;
  timestamp: string;
}

export type ServerEvent =
  | ServerConnectedEvent
  | ServerDisconnectedEvent
  | ServerErrorEvent
  | ServerResetEvent;

/**
 * Combined event type for the event emitter.
 */
export type AppEvent = LoopEvent | ServerEvent;

/**
 * Connection state for a workspace.
 */
interface WorkspaceConnectionState {
  backend: Backend;
  settings: ServerSettings;
  connectionError: string | null;
}

/**
 * Build a BackendConnectionConfig from ServerSettings and a directory.
 * This is a utility function for cases where you have settings that aren't
 * from the backendManager (e.g., testing a connection with proposed settings).
 * 
 * @param settings - Server settings to use
 * @param directory - Working directory for the connection
 * @returns A complete BackendConnectionConfig
 */
export function buildConnectionConfig(settings: ServerSettings, directory: string): BackendConnectionConfig {
  return {
    mode: settings.mode,
    hostname: settings.hostname,
    port: settings.port,
    password: settings.password,
    useHttps: settings.useHttps,
    allowInsecure: settings.allowInsecure,
    directory,
  };
}

/**
 * Backend manager supporting multiple workspace connections.
 * Each workspace can have its own server settings and connection.
 */
class BackendManager {
  /** Map of workspace ID to connection state */
  private connections = new Map<string, WorkspaceConnectionState>();
  private initialized = false;
  /** Custom executor factory for testing */
  private testExecutorFactory: CommandExecutorFactory | null = null;
  /** Flag to indicate a test backend is being used (should be preserved on reset) */
  private isTestBackend = false;
  /** Test backend instance (when isTestBackend is true) */
  private testBackend: Backend | null = null;
  /** Test settings (when isTestBackend is true) */
  private testSettings: ServerSettings = getDefaultServerSettings();

  /**
   * Initialize the backend manager.
   * No longer loads global settings - settings are per-workspace.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
  }

  /**
   * Connect to the backend for a specific workspace.
   * Uses the workspace's server settings for the connection.
   * 
   * @param workspaceId - The workspace ID to connect for
   * @param directory - The working directory for the connection
   */
  async connect(workspaceId: string, directory: string): Promise<void> {
    // If using test backend, use that instead
    if (this.isTestBackend && this.testBackend) {
      return this.connectWithTestBackend(workspaceId, directory);
    }

    // Get the workspace to retrieve its server settings
    const workspace = await getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    const settings = workspace.serverSettings;
    let state = this.connections.get(workspaceId);

    // Create new connection state if it doesn't exist
    if (!state) {
      state = {
        backend: new OpenCodeBackend(),
        settings,
        connectionError: null,
      };
      this.connections.set(workspaceId, state);
    } else {
      // Update settings from workspace (in case they changed)
      state.settings = settings;
    }

    // If already connected, disconnect first
    if (state.backend.isConnected()) {
      await state.backend.disconnect();
    }

    state.connectionError = null;

    const config = buildConnectionConfig(settings, directory);

    try {
      await state.backend.connect(config);
      
      // Determine the correct protocol for the server URL
      const port = settings.port ?? 4096;
      const useHttps = settings.useHttps ?? false;
      const protocol = useHttps ? "https" : "http";
      
      this.emitEvent({
        type: "server.connected",
        workspaceId,
        mode: settings.mode,
        serverUrl:
          settings.mode === "connect"
            ? `${protocol}://${settings.hostname}:${port}`
            : undefined,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      state.connectionError = String(error);
      this.emitEvent({
        type: "server.error",
        workspaceId,
        error: state.connectionError,
        timestamp: new Date().toISOString(),
      });
      throw error;
    }
  }

  /**
   * Connect using the test backend (for testing purposes).
   */
  private async connectWithTestBackend(workspaceId: string, directory: string): Promise<void> {
    if (!this.testBackend) {
      throw new Error("Test backend not set");
    }

    // Create connection state with test backend
    let state = this.connections.get(workspaceId);
    if (!state) {
      state = {
        backend: this.testBackend,
        settings: this.testSettings,
        connectionError: null,
      };
      this.connections.set(workspaceId, state);
    }

    // If not connected, connect
    if (!state.backend.isConnected()) {
      const config = buildConnectionConfig(state.settings, directory);
      await state.backend.connect(config);
    }

    this.emitEvent({
      type: "server.connected",
      workspaceId,
      mode: state.settings.mode,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Disconnect from the backend for a specific workspace.
   */
  async disconnectWorkspace(workspaceId: string): Promise<void> {
    const state = this.connections.get(workspaceId);
    if (state && state.backend.isConnected()) {
      await state.backend.disconnect();
      this.emitEvent({
        type: "server.disconnected",
        workspaceId,
        timestamp: new Date().toISOString(),
      });
    }
    if (state) {
      state.connectionError = null;
    }
  }

  /**
   * Reset connection for a specific workspace.
   * Disconnects the backend and clears the cached instance.
   * Used for recovery when connections become stale.
   */
  async resetWorkspaceConnection(workspaceId: string): Promise<void> {
    const state = this.connections.get(workspaceId);
    
    if (state) {
      // Abort all active subscriptions first
      state.backend.abortAllSubscriptions();
      
      // If using test backend, preserve it
      if (this.isTestBackend) {
        state.connectionError = null;
        this.emitEvent({
          type: "server.reset",
          workspaceId,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Disconnect cleanly
      if (state.backend.isConnected()) {
        await state.backend.disconnect();
      }
      
      // Remove from connections map
      this.connections.delete(workspaceId);
    }
    
    this.emitEvent({
      type: "server.reset",
      workspaceId,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Reset all workspace connections.
   * Disconnects all backends and clears all cached instances.
   */
  async resetAllConnections(): Promise<void> {
    for (const [workspaceId, state] of this.connections) {
      try {
        state.backend.abortAllSubscriptions();
        if (state.backend.isConnected()) {
          await state.backend.disconnect();
        }
      } catch (error) {
        log.error(`Error resetting connection for workspace ${workspaceId}: ${String(error)}`);
      }
    }
    
    // If not using test backend, clear all connections
    if (!this.isTestBackend) {
      this.connections.clear();
    }
    
    this.emitEvent({
      type: "server.reset",
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Test connection with provided settings (without updating workspace settings).
   * Returns true if connection succeeds, false otherwise.
   */
  async testConnection(
    settings: ServerSettings,
    directory: string
  ): Promise<{ success: boolean; error?: string }> {
    // Create a temporary backend for testing
    const testBackend = new OpenCodeBackend();

    const config = buildConnectionConfig(settings, directory);

    try {
      await testBackend.connect(config);
      await testBackend.disconnect();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Validate that a directory exists and is a git repository on the remote server.
   * This is used during workspace creation to validate the directory before saving.
   * 
   * @param settings - Server settings to use for connection
   * @param directory - The directory to validate
   * @returns Object with success flag, isGitRepo boolean, directoryExists boolean, and optional error message
   */
  async validateRemoteDirectory(
    settings: ServerSettings,
    directory: string
  ): Promise<{ success: boolean; isGitRepo?: boolean; directoryExists?: boolean; error?: string }> {
    log.debug("Validating remote directory", { directory, mode: settings.mode });
    
    // In test mode, use the test executor factory if available
    if (this.testExecutorFactory) {
      log.debug("Using test executor factory for directory validation");
      const executor = this.testExecutorFactory(directory);
      
      // First check if directory exists
      const directoryExists = await executor.directoryExists(directory);
      if (!directoryExists) {
        log.debug("Directory does not exist on remote server", { directory });
        return { success: true, directoryExists: false, isGitRepo: false };
      }
      
      const git = GitService.withExecutor(executor);
      const isGitRepo = await git.isGitRepo(directory);
      return { success: true, directoryExists: true, isGitRepo };
    }
    
    // Create a temporary backend for validation
    const tempBackend = new OpenCodeBackend();
    const config = buildConnectionConfig(settings, directory);

    try {
      // Connect to the server
      await tempBackend.connect(config);
      
      // Get connection info and client
      const connectionInfo = tempBackend.getConnectionInfo();
      const client = tempBackend.getSdkClient() as OpencodeClient | null;
      
      if (!connectionInfo || !client) {
        await tempBackend.disconnect();
        return { success: false, error: "Failed to get connection info" };
      }
      
      // Create a command executor
      const executor = new CommandExecutorImpl({
        client,
        directory,
        baseUrl: connectionInfo.baseUrl,
        authHeaders: connectionInfo.authHeaders,
        allowInsecure: connectionInfo.allowInsecure,
      });
      
      // First check if directory exists to provide clearer error messages
      const directoryExists = await executor.directoryExists(directory);
      if (!directoryExists) {
        log.debug("Directory does not exist on remote server", { directory });
        await tempBackend.disconnect();
        return { success: true, directoryExists: false, isGitRepo: false };
      }
      
      // Use GitService to check if it's a git repository (consistent with rest of codebase)
      const git = GitService.withExecutor(executor);
      const isGitRepo = await git.isGitRepo(directory);
      
      log.debug("Remote directory validation result", { directory, directoryExists: true, isGitRepo });
      
      // Disconnect
      await tempBackend.disconnect();
      
      return { success: true, directoryExists: true, isGitRepo };
    } catch (error) {
      log.error("Failed to validate remote directory", { directory, error: String(error) });
      try {
        await tempBackend.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get connection status for a specific workspace.
   */
  getWorkspaceStatus(workspaceId: string): ConnectionStatus {
    const state = this.connections.get(workspaceId);
    
    if (!state) {
      return {
        connected: false,
        mode: "spawn",
        error: undefined,
      };
    }

    const connected = state.backend.isConnected();
    const port = state.settings.port ?? 4096;
    const useHttps = state.settings.useHttps ?? false;
    const protocol = useHttps ? "https" : "http";

    return {
      connected,
      mode: state.settings.mode,
      serverUrl:
        state.settings.mode === "connect" && state.settings.hostname
          ? `${protocol}://${state.settings.hostname}:${port}`
          : undefined,
      error: state.connectionError ?? undefined,
    };
  }

  /**
   * Get server settings for a workspace.
   * In test mode (when setBackendForTesting was called), returns test settings.
   * In production, fetches the workspace from the database.
   * 
   * @param workspaceId - The workspace ID
   * @returns The server settings for the workspace
   * @throws Error if workspace not found (in non-test mode)
   */
  async getWorkspaceSettings(workspaceId: string): Promise<ServerSettings> {
    // In test mode, return test settings
    if (this.isTestBackend) {
      return this.testSettings;
    }

    // In production, fetch from database
    const workspace = await getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    return workspace.serverSettings;
  }

  /**
   * Get the backend instance for a workspace.
   * Creates a new backend if one doesn't exist.
   */
  getBackend(workspaceId: string): Backend {
    // Use test backend if set
    if (this.isTestBackend && this.testBackend) {
      return this.testBackend;
    }

    const state = this.connections.get(workspaceId);
    if (state) {
      return state.backend;
    }
    
    // Create a new backend on demand
    const backend = new OpenCodeBackend();
    this.connections.set(workspaceId, {
      backend,
      settings: getDefaultServerSettings(),
      connectionError: null,
    });
    return backend;
  }

  /**
   * Check if a workspace is connected.
   */
  isWorkspaceConnected(workspaceId: string): boolean {
    const state = this.connections.get(workspaceId);
    return state?.backend.isConnected() ?? false;
  }

  /**
   * Get a CommandExecutor for running commands on the opencode server.
   * All commands go through the PTY+WebSocket connection, regardless of mode.
   * Commands are queued to ensure only one runs at a time.
   * 
   * Note: This method is synchronous and cannot establish connections.
   * Ensure connect() has been called first.
   * 
   * @param workspaceId - The workspace ID
   * @param directory - The directory to run commands in
   * @returns A CommandExecutor instance
   */
  getCommandExecutor(workspaceId: string, directory?: string): CommandExecutor {
    // Use test factory if set (for testing)
    if (this.testExecutorFactory) {
      return this.testExecutorFactory(directory ?? ".");
    }

    const state = this.connections.get(workspaceId);
    if (!state || !state.backend.isConnected()) {
      throw new Error(`[BackendManager] Workspace ${workspaceId} not connected! Call connect() first.`);
    }

    // Get the SDK client (cast to OpencodeClient since Backend interface is agnostic)
    const client = state.backend.getSdkClient() as OpencodeClient | null;
    if (!client) {
      throw new Error("[BackendManager] No SDK client available");
    }

    // Get connection info (baseUrl and auth headers)
    const connectionInfo = state.backend.getConnectionInfo();
    if (!connectionInfo) {
      throw new Error("[BackendManager] No connection info available");
    }

    // Use the provided directory or the backend's current directory
    const dir = directory ?? state.backend.getDirectory();

    log.debug(`[BackendManager] Creating CommandExecutor for workspace ${workspaceId} (baseUrl: ${connectionInfo.baseUrl}, directory: ${dir})`);
    return new CommandExecutorImpl({
      client,
      directory: dir,
      baseUrl: connectionInfo.baseUrl,
      authHeaders: connectionInfo.authHeaders,
      allowInsecure: connectionInfo.allowInsecure,
    });
  }

  /**
   * Get a CommandExecutor for running commands on the opencode server.
   * This async version will establish a connection if needed.
   * All commands go through the PTY+WebSocket connection, regardless of mode.
   * Commands are queued to ensure only one runs at a time.
   * 
   * @param workspaceId - The workspace ID
   * @param directory - The directory to run commands in (required)
   * @returns A CommandExecutor instance
   */
  async getCommandExecutorAsync(workspaceId: string, directory: string): Promise<CommandExecutor> {
    // Use test factory if set (for testing)
    if (this.testExecutorFactory) {
      return this.testExecutorFactory(directory);
    }

    // Ensure we're connected
    if (!this.isWorkspaceConnected(workspaceId)) {
      log.debug(`[BackendManager] Establishing connection for workspace ${workspaceId}...`);
      await this.connect(workspaceId, directory);
    }

    // Now get the executor (should be connected)
    return this.getCommandExecutor(workspaceId, directory);
  }

  /**
   * Set a custom backend instance (for testing).
   * This bypasses the normal OpenCodeBackend creation.
   * Accepts OpenCodeBackend or MockOpenCodeBackend (both implement Backend).
   */
  setBackendForTesting(backend: Backend): void {
    this.testBackend = backend;
    this.initialized = true;
    this.isTestBackend = true;
  }

  /**
   * Set test settings (for testing).
   * Also enables test mode if not already enabled.
   */
  setSettingsForTesting(settings: ServerSettings): void {
    this.testSettings = settings;
    this.isTestBackend = true;
    this.initialized = true;
  }

  /**
   * Enable test mode without setting a specific backend.
   * This causes getWorkspaceSettings() to return test settings instead
   * of querying the database.
   * Useful when tests create their own mock backends but still need
   * the backend manager to return test settings.
   */
  enableTestMode(): void {
    this.isTestBackend = true;
    this.initialized = true;
  }

  /**
   * Set a custom command executor factory (for testing).
   * This bypasses the normal PTY-based executor creation.
   */
  setExecutorFactoryForTesting(factory: CommandExecutorFactory): void {
    this.testExecutorFactory = factory;
  }

  /**
   * Reset the backend manager (for testing).
   * Clears all connections and resets initialization state.
   */
  resetForTesting(): void {
    this.connections.clear();
    this.initialized = false;
    this.testExecutorFactory = null;
    this.isTestBackend = false;
    this.testBackend = null;
    this.testSettings = getDefaultServerSettings();
  }

  /**
   * Emit a server event.
   */
  private emitEvent(event: ServerEvent): void {
    // Cast to LoopEvent since the emitter accepts that type
    // The WebSocket handler will pass through any event with a type property
    loopEventEmitter.emit(event as unknown as LoopEvent);
  }
}

/**
 * Global backend manager singleton.
 */
export const backendManager = new BackendManager();
