/**
 * Backend manager for Ralph Loops Management System.
 * Manages multiple workspace-specific backend connections.
 * 
 * Each workspace can have its own server settings and connection,
 * allowing parallel operation of loops across different workspaces.
 */

import { OpenCodeBackend } from "../backends/opencode";
import type { BackendConnectionConfig, Backend } from "../backends/types";
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
 * Agent transports that require an explicit remote endpoint.
 */
const REMOTE_AGENT_TRANSPORTS = new Set(["ssh"]);

/**
 * Default timeout (in ms) for remote connection operations (validation, test connections,
 * workspace connections). This bounds network operations to prevent indefinite hangs
 * when the remote server is unreachable.
 */
const DEFAULT_CONNECTION_TIMEOUT_MS = 15_000;

/**
 * Factory function type for creating command executors.
 */
export type CommandExecutorFactory = (directory: string) => CommandExecutor;

interface DerivedExecutionSettings {
  provider: "local" | "ssh";
  host?: string;
  port?: number;
  user?: string;
  password?: string;
}

function getProviderAcpCommand(provider: "opencode" | "copilot"): { command: string; args: string[] } {
  if (provider === "copilot") {
    return { command: "copilot", args: ["--acp"] };
  }
  return { command: "opencode", args: ["acp"] };
}

function deriveExecutionSettings(settings: ServerSettings): DerivedExecutionSettings {
  if (settings.agent.transport === "ssh") {
    return {
      provider: "ssh",
      host: settings.agent.hostname,
      port: settings.agent.port ?? 22,
      user: settings.agent.username?.trim() || undefined,
      password: settings.agent.password?.trim() || undefined,
    };
  }

  return { provider: "local" };
}

function buildAgentRuntimeCommand(settings: ServerSettings): { command: string; args: string[] } {
  const provider = settings.agent.provider;
  const providerCommand = getProviderAcpCommand(provider);

  if (settings.agent.transport === "stdio") {
    return providerCommand;
  }

  const sshTarget = settings.agent.username?.trim()
    ? `${settings.agent.username.trim()}@${settings.agent.hostname}`
    : settings.agent.hostname;
  const sshArgs = [
    "-p",
    String(settings.agent.port ?? 22),
    sshTarget,
    "--",
    providerCommand.command,
    ...providerCommand.args,
  ];

  if (settings.agent.password && settings.agent.password.trim().length > 0) {
    return {
      command: "sshpass",
      args: ["-p", settings.agent.password, "ssh", ...sshArgs],
    };
  }

  return {
    command: "ssh",
    args: sshArgs,
  };
}

/**
 * Server status events.
 * These are emitted via the global event emitter.
 */
export interface ServerConnectedEvent {
  type: "server.connected";
  workspaceId?: string;
  /** Legacy runtime mode field (ACP path currently emits "spawn"). */
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
 * Used for workspace-level operations (directory validation, model listing, name generation).
 */
interface WorkspaceConnectionState {
  backend: Backend;
  settings: ServerSettings;
  connectionError: string | null;
}

/**
 * Connection state for a loop.
 * Each loop gets its own dedicated backend connection.
 * The actual directory binding happens later when LoopEngine calls backend.connect()
 * in setupSession() with the worktree directory.
 */
interface LoopConnectionState {
  backend: Backend;
  workspaceId: string;
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
  const derivedCommand = buildAgentRuntimeCommand(settings);
  const sshAgent = settings.agent.transport === "ssh" ? settings.agent : undefined;
  return {
    mode: "spawn",
    provider: settings.agent.provider,
    transport: settings.agent.transport,
    hostname: sshAgent?.hostname,
    port: sshAgent?.port ?? (sshAgent ? 22 : undefined),
    username: sshAgent?.username?.trim() || undefined,
    password: sshAgent?.password,
    command: derivedCommand.command,
    args: derivedCommand.args,
    directory,
  };
}

/**
 * Build a displayable server URL for agent transports that expose host/port.
 */
function buildAgentServerUrl(settings: ServerSettings): string | undefined {
  if (!REMOTE_AGENT_TRANSPORTS.has(settings.agent.transport) || settings.agent.transport !== "ssh") {
    return undefined;
  }
  return `ssh://${settings.agent.hostname}:${settings.agent.port ?? 22}`;
}

/**
 * Backend manager supporting multiple workspace connections.
 * Each workspace can have its own server settings and connection.
 */
class BackendManager {
  /** Map of workspace ID to connection state (for workspace-level operations) */
  private connections = new Map<string, WorkspaceConnectionState>();
  /** Map of loop ID to its own dedicated backend connection */
  private loopConnections = new Map<string, LoopConnectionState>();
  private initialized = false;
  /** Custom executor factory for testing */
  private testExecutorFactory: CommandExecutorFactory | null = null;
  /** Flag to indicate a test backend is being used (should be preserved on reset) */
  private isTestBackend = false;
  /** Test backend instance (when isTestBackend is true) */
  private testBackend: Backend | null = null;
  /** Test settings (when isTestBackend is true) */
  private testSettings: ServerSettings = getDefaultServerSettings();
  /** Overridable connection timeout (ms) for testing. Defaults to DEFAULT_CONNECTION_TIMEOUT_MS. */
  private connectionTimeoutMs: number = DEFAULT_CONNECTION_TIMEOUT_MS;

  /**
   * Create a backend instance for the configured agent provider.
   */
  private createBackendForSettings(settings: ServerSettings): Backend {
    switch (settings.agent.provider) {
      case "opencode":
      case "copilot":
        // Both providers use the same backend implementation for now.
        return new OpenCodeBackend();
      default:
        return new OpenCodeBackend();
    }
  }

  /**
   * Static capabilities exposed to the status endpoint.
   */
  private getAgentCapabilities(settings: ServerSettings): string[] {
    if (settings.agent.provider === "opencode") {
      return ["createSession", "sendPromptAsync", "abortSession", "subscribeToEvents", "models"];
    }
    return ["createSession", "sendPromptAsync", "abortSession", "subscribeToEvents"];
  }

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
        backend: this.createBackendForSettings(settings),
        settings,
        connectionError: null,
      };
      this.connections.set(workspaceId, state);
    } else {
      // Update settings from workspace (in case they changed)
      if (state.settings.agent.provider !== settings.agent.provider) {
        state.backend = this.createBackendForSettings(settings);
      }
      state.settings = settings;
    }

    // If already connected, disconnect first
    if (state.backend.isConnected()) {
      await state.backend.disconnect();
    }

    state.connectionError = null;

    const config = buildConnectionConfig(settings, directory);

    // Use a timeout + AbortController to prevent indefinite hangs when the
    // remote server is unreachable (connectToExisting disables Bun's request timeout).
    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Connection timed out after ${this.connectionTimeoutMs}ms`)),
          this.connectionTimeoutMs,
        );
      });

      await Promise.race([
        state.backend.connect(config, abortController.signal),
        timeoutPromise,
      ]);
      
      this.emitEvent({
        type: "server.connected",
        workspaceId,
        mode: config.mode,
        serverUrl: buildAgentServerUrl(settings),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      abortController.abort();
      state.connectionError = String(error);
      this.emitEvent({
        type: "server.error",
        workspaceId,
        error: state.connectionError,
        timestamp: new Date().toISOString(),
      });
      throw error;
    } finally {
      clearTimeout(timeoutId);
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
      mode: buildConnectionConfig(state.settings, directory).mode,
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
    // Reset all workspace-level connections
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
    
    // Reset all loop-level connections
    for (const [loopId, state] of this.loopConnections) {
      try {
        state.backend.abortAllSubscriptions();
        if (state.backend.isConnected()) {
          await state.backend.disconnect();
        }
      } catch (error) {
        log.error(`Error resetting loop connection for ${loopId}: ${String(error)}`);
      }
    }
    
    // If not using test backend, clear all connections
    if (!this.isTestBackend) {
      this.connections.clear();
      this.loopConnections.clear();
    }
    
    this.emitEvent({
      type: "server.reset",
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Test connection with provided settings (without updating workspace settings).
   * Returns true if connection succeeds, false otherwise.
   * Uses a timeout + AbortController to prevent indefinite hangs when the
   * remote server is unreachable.
   */
  async testConnection(
    settings: ServerSettings,
    directory: string
  ): Promise<{ success: boolean; error?: string }> {
    // Create a temporary backend for testing
    const testBackend = this.createBackendForSettings(settings);
    const config = buildConnectionConfig(settings, directory);
    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Connection timed out after ${this.connectionTimeoutMs}ms`)),
          this.connectionTimeoutMs,
        );
      });

      await Promise.race([
        testBackend.connect(config, abortController.signal),
        timeoutPromise,
      ]);

      await testBackend.disconnect();
      return { success: true };
    } catch (error) {
      abortController.abort();
      try {
        await testBackend.disconnect();
      } catch {
        // Ignore disconnect errors during cleanup
      }
      return { success: false, error: String(error) };
    } finally {
      clearTimeout(timeoutId);
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
    log.debug("Validating remote directory", {
      directory,
      provider: settings.agent.provider,
      transport: settings.agent.transport,
      executionProvider: deriveExecutionSettings(settings).provider,
    });
    
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

    try {
      const execution = deriveExecutionSettings(settings);
      const executor = new CommandExecutorImpl({
        provider: execution.provider,
        directory,
        host: execution.host,
        port: execution.port,
        user: execution.user,
        password: execution.password,
        timeoutMs: this.connectionTimeoutMs,
      });

      if (execution.provider === "ssh") {
        const connectivityProbe = await executor.exec("true", [], { cwd: "/" });
        if (!connectivityProbe.success) {
          const detail = connectivityProbe.stderr || connectivityProbe.stdout || `exit code ${connectivityProbe.exitCode}`;
          return {
            success: false,
            error: `Failed to connect to remote server: ${detail}`,
          };
        }
      }

      const directoryExists = await executor.directoryExists(directory);
      if (!directoryExists) {
        log.debug("Directory does not exist on execution target", { directory });
        return { success: true, directoryExists: false, isGitRepo: false };
      }

      const git = GitService.withExecutor(executor);
      const isGitRepo = await git.isGitRepo(directory);
      return { success: true, directoryExists: true, isGitRepo };
    } catch (error) {
      log.error("Failed to validate remote directory", { directory, error: String(error) });
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get connection status for a specific workspace.
   */
  async getWorkspaceStatus(workspaceId: string): Promise<ConnectionStatus> {
    const workspace = await getWorkspace(workspaceId);
    const settings = workspace?.serverSettings ?? getDefaultServerSettings();
    const state = this.connections.get(workspaceId);
    const status: ConnectionStatus = {
      connected: state?.backend.isConnected() ?? false,
      provider: settings.agent.provider,
      transport: settings.agent.transport,
      capabilities: this.getAgentCapabilities(settings),
      serverUrl: buildAgentServerUrl(settings),
      error: state?.connectionError ?? undefined,
    };

    if (!workspace) {
      status.connected = false;
      status.error = "Workspace not found";
      return status;
    }

    try {
      const executor = await this.getCommandExecutorAsync(workspaceId, workspace.directory);
      const directoryExists = await executor.directoryExists(workspace.directory);
      let isGitRepo = false;
      if (directoryExists) {
        const git = GitService.withExecutor(executor);
        isGitRepo = await git.isGitRepo(workspace.directory);
      }
      status.directoryExists = directoryExists;
      status.isGitRepo = isGitRepo;
      status.connected = status.connected && directoryExists;
    } catch (error) {
      status.connected = false;
      status.error = state?.connectionError ?? String(error);
    }

    return status;
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
   * Get the backend instance for a workspace (workspace-level operations only).
   * Used for operations that don't belong to a specific loop (name generation,
   * model listing, directory validation).
   * Creates a new backend if one doesn't exist.
   * 
   * IMPORTANT: Do NOT use this for loop execution. Use getLoopBackend() instead.
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
    const defaultSettings = getDefaultServerSettings();
    const backend = this.createBackendForSettings(defaultSettings);
    this.connections.set(workspaceId, {
      backend,
      settings: defaultSettings,
      connectionError: null,
    });
    return backend;
  }

  /**
   * Get a dedicated backend instance for a loop.
   * Each loop gets its own OpenCodeBackend so that concurrent loops
   * in the same workspace don't interfere with each other.
   * 
   * The actual directory binding happens later when LoopEngine calls
   * backend.connect() in setupSession() with the worktree directory.
   * 
   * In test mode, returns the shared test backend (tests manage their own isolation).
   * 
   * @param loopId - The loop ID
   * @param workspaceId - The workspace ID (for settings lookup)
   * @returns A Backend instance dedicated to this loop
   */
  getLoopBackend(loopId: string, workspaceId: string): Backend {
    // Use test backend if set (tests share a single mock backend)
    if (this.isTestBackend && this.testBackend) {
      return this.testBackend;
    }

    const existing = this.loopConnections.get(loopId);
    if (existing) {
      return existing.backend;
    }

    // Create a new dedicated backend for this loop
    const settings = this.connections.get(workspaceId)?.settings ?? getDefaultServerSettings();
    const backend = this.createBackendForSettings(settings);
    this.loopConnections.set(loopId, {
      backend,
      workspaceId,
    });
    log.debug(`[BackendManager] Created dedicated backend for loop ${loopId}`);
    return backend;
  }

  /**
   * Disconnect and clean up the backend for a specific loop.
   * Called when a loop is stopped, completed, or failed.
   * 
   * @param loopId - The loop ID to clean up
   */
  async disconnectLoop(loopId: string): Promise<void> {
    // In test mode, don't disconnect the shared test backend
    if (this.isTestBackend) {
      return;
    }

    const state = this.loopConnections.get(loopId);
    if (!state) {
      return;
    }

    try {
      state.backend.abortAllSubscriptions();
      if (state.backend.isConnected()) {
        await state.backend.disconnect();
      }
    } catch (error) {
      log.error(`[BackendManager] Error disconnecting loop ${loopId}: ${String(error)}`);
    }

    this.loopConnections.delete(loopId);
    log.debug(`[BackendManager] Cleaned up backend for loop ${loopId}`);
  }

  /**
   * Check if a workspace is connected.
   */
  isWorkspaceConnected(workspaceId: string): boolean {
    const state = this.connections.get(workspaceId);
    return state?.backend.isConnected() ?? false;
  }

  /**
   * Get a CommandExecutor for running deterministic commands/files via execution settings.
   */
  getCommandExecutor(workspaceId: string, directory?: string): CommandExecutor {
    // Use test factory if set (for testing)
    if (this.testExecutorFactory) {
      return this.testExecutorFactory(directory ?? ".");
    }

    const state = this.connections.get(workspaceId);
    if (!state) {
      throw new Error(`[BackendManager] Workspace ${workspaceId} not initialized`);
    }

    const dir = directory ?? state.backend.getDirectory();
    const execution = deriveExecutionSettings(state.settings);
    log.debug(`[BackendManager] Creating CommandExecutor for workspace ${workspaceId}`, {
      directory: dir,
      executionProvider: execution.provider,
      host: execution.host,
      port: execution.port,
      user: execution.user,
    });
    return new CommandExecutorImpl({
      provider: execution.provider,
      directory: dir,
      host: execution.host,
      port: execution.port,
      user: execution.user,
      password: execution.password,
    });
  }

  /**
   * Get a CommandExecutor for running commands/files via execution settings.
   */
  async getCommandExecutorAsync(workspaceId: string, directory: string): Promise<CommandExecutor> {
    // Use test factory if set (for testing)
    if (this.testExecutorFactory) {
      return this.testExecutorFactory(directory);
    }

    // Ensure workspace settings are loaded into state for executor creation.
    let state = this.connections.get(workspaceId);
    if (!state) {
      const workspace = await getWorkspace(workspaceId);
      if (!workspace) {
        throw new Error(`Workspace not found: ${workspaceId}`);
      }
      state = {
        backend: this.createBackendForSettings(workspace.serverSettings),
        settings: workspace.serverSettings,
        connectionError: null,
      };
      this.connections.set(workspaceId, state);
    }

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
   * Get the test backend if set (for model validation and similar use cases).
   * Returns null if no test backend is set.
   */
  getTestBackend(): Backend | null {
    if (this.isTestBackend && this.testBackend) {
      return this.testBackend;
    }
    return null;
  }

  /**
   * Create a new backend instance for ad-hoc operations (e.g. model discovery).
   */
  createBackend(settings: ServerSettings): Backend {
    return this.createBackendForSettings(settings);
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
   * This bypasses the normal execution-provider-based executor creation.
   */
  setExecutorFactoryForTesting(factory: CommandExecutorFactory): void {
    this.testExecutorFactory = factory;
  }

  /**
   * Override the connection timeout (for testing).
   * Allows tests to use a much shorter timeout to avoid long wall-clock waits.
   */
  setConnectionTimeoutForTesting(timeoutMs: number): void {
    this.connectionTimeoutMs = timeoutMs;
  }

  /**
   * Reset the backend manager (for testing).
   * Clears all connections and resets initialization state.
   */
  resetForTesting(): void {
    this.connections.clear();
    this.loopConnections.clear();
    this.initialized = false;
    this.testExecutorFactory = null;
    this.isTestBackend = false;
    this.testBackend = null;
    this.testSettings = getDefaultServerSettings();
    this.connectionTimeoutMs = DEFAULT_CONNECTION_TIMEOUT_MS;
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
