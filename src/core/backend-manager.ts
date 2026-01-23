/**
 * Global backend manager for Ralph Loops Management System.
 * Manages a single global backend connection used by all loops.
 */

import { OpenCodeBackend } from "../backends/opencode";
import type { AgentBackend, BackendConnectionConfig } from "../backends/types";
import { getServerSettings, setServerSettings } from "../persistence/preferences";
import {
  getDefaultServerSettings,
  type ConnectionStatus,
  type ServerSettings,
} from "../types/settings";
import { loopEventEmitter } from "./event-emitter";
import type { LoopEvent } from "../types/events";
import type { CommandExecutor } from "./command-executor";
import { CommandExecutorImpl } from "./remote-command-executor";
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
  mode: "spawn" | "connect";
  serverUrl?: string;
  timestamp: string;
}

export interface ServerDisconnectedEvent {
  type: "server.disconnected";
  timestamp: string;
}

export interface ServerErrorEvent {
  type: "server.error";
  error: string;
  timestamp: string;
}

export type ServerEvent =
  | ServerConnectedEvent
  | ServerDisconnectedEvent
  | ServerErrorEvent;

/**
 * Combined event type for the event emitter.
 */
export type AppEvent = LoopEvent | ServerEvent;

/**
 * Global backend manager.
 * Maintains a single backend connection based on server settings.
 */
class BackendManager {
  private backend: OpenCodeBackend | null = null;
  private settings: ServerSettings = getDefaultServerSettings();
  private connectionError: string | null = null;
  private initialized = false;
  /** Custom executor factory for testing */
  private testExecutorFactory: CommandExecutorFactory | null = null;

  /**
   * Initialize the backend manager.
   * Loads settings from preferences but does NOT auto-connect.
   * Connection happens on first use or explicit connect().
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.settings = await getServerSettings();
    this.initialized = true;
  }

  /**
   * Connect to the backend using current settings.
   * For spawn mode: connection is deferred until needed (per-directory).
   * For connect mode: verifies the remote server is accessible.
   */
  async connect(directory: string): Promise<void> {
    // Ensure we have a backend instance
    if (!this.backend) {
      this.backend = new OpenCodeBackend();
    }

    // If already connected, disconnect first
    if (this.backend.isConnected()) {
      await this.backend.disconnect();
    }

    this.connectionError = null;

    const config: BackendConnectionConfig = {
      mode: this.settings.mode,
      hostname: this.settings.hostname,
      port: this.settings.port,
      password: this.settings.password,
      directory,
    };

    try {
      await this.backend.connect(config);
      this.emitEvent({
        type: "server.connected",
        mode: this.settings.mode,
        serverUrl:
          this.settings.mode === "connect"
            ? `http://${this.settings.hostname}:${this.settings.port}`
            : undefined,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      this.connectionError = String(error);
      this.emitEvent({
        type: "server.error",
        error: this.connectionError,
        timestamp: new Date().toISOString(),
      });
      throw error;
    }
  }

  /**
   * Disconnect from the current backend.
   */
  async disconnect(): Promise<void> {
    if (this.backend && this.backend.isConnected()) {
      await this.backend.disconnect();
      this.emitEvent({
        type: "server.disconnected",
        timestamp: new Date().toISOString(),
      });
    }
    this.connectionError = null;
  }

  /**
   * Update server settings.
   * Does NOT reconnect automatically - call connect() after if needed.
   */
  async updateSettings(settings: ServerSettings): Promise<void> {
    this.settings = settings;
    await setServerSettings(settings);
  }

  /**
   * Test connection with provided settings (without updating current settings).
   * Returns true if connection succeeds, false otherwise.
   */
  async testConnection(
    settings: ServerSettings,
    directory: string
  ): Promise<{ success: boolean; error?: string }> {
    // Create a temporary backend for testing
    const testBackend = new OpenCodeBackend();

    const config: BackendConnectionConfig = {
      mode: settings.mode,
      hostname: settings.hostname,
      port: settings.port,
      password: settings.password,
      directory,
    };

    try {
      await testBackend.connect(config);
      await testBackend.disconnect();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get current connection status.
   */
  getStatus(): ConnectionStatus {
    const connected = this.backend?.isConnected() ?? false;

    return {
      connected,
      mode: this.settings.mode,
      serverUrl:
        this.settings.mode === "connect" && this.settings.hostname
          ? `http://${this.settings.hostname}:${this.settings.port ?? 4096}`
          : undefined,
      error: this.connectionError ?? undefined,
    };
  }

  /**
   * Get current server settings.
   */
  getSettings(): ServerSettings {
    return { ...this.settings };
  }

  /**
   * Get the backend instance.
   * Throws if not initialized.
   */
  getBackend(): AgentBackend {
    if (!this.backend) {
      // Create backend on demand
      this.backend = new OpenCodeBackend();
    }
    return this.backend;
  }

  /**
   * Check if the backend is connected.
   */
  isConnected(): boolean {
    return this.backend?.isConnected() ?? false;
  }

  /**
   * Get a CommandExecutor for running commands on the opencode server.
   * All commands go through the PTY+WebSocket connection, regardless of mode.
   * Commands are queued to ensure only one runs at a time.
   * 
   * Note: This method is synchronous and cannot establish connections.
   * Ensure connect() has been called first.
   * 
   * @param directory - The directory to run commands in
   * @returns A CommandExecutor instance
   */
  getCommandExecutor(directory?: string): CommandExecutor {
    // Use test factory if set (for testing)
    if (this.testExecutorFactory) {
      return this.testExecutorFactory(directory ?? ".");
    }

    // Check if we have a connected backend
    if (!this.backend?.isConnected()) {
      throw new Error("[BackendManager] Backend not connected! Call connect() first.");
    }

    // Get the SDK client
    const client = this.backend.getSdkClient();
    if (!client) {
      throw new Error("[BackendManager] No SDK client available");
    }

    // Get connection info (baseUrl and auth headers)
    const connectionInfo = this.backend.getConnectionInfo();
    if (!connectionInfo) {
      throw new Error("[BackendManager] No connection info available");
    }

    // Use the provided directory or the backend's current directory
    const dir = directory ?? this.backend.getDirectory();

    log.debug(`[BackendManager] Creating CommandExecutor (baseUrl: ${connectionInfo.baseUrl}, directory: ${dir})`);
    return new CommandExecutorImpl({
      client,
      directory: dir,
      baseUrl: connectionInfo.baseUrl,
      authHeaders: connectionInfo.authHeaders,
    });
  }

  /**
   * Get a CommandExecutor for running commands on the opencode server.
   * This async version will establish a connection if needed.
   * All commands go through the PTY+WebSocket connection, regardless of mode.
   * Commands are queued to ensure only one runs at a time.
   * 
   * @param directory - The directory to run commands in (required)
   * @returns A CommandExecutor instance
   */
  async getCommandExecutorAsync(directory: string): Promise<CommandExecutor> {
    // Use test factory if set (for testing)
    if (this.testExecutorFactory) {
      return this.testExecutorFactory(directory);
    }

    // Ensure we're connected
    if (!this.backend?.isConnected()) {
      log.debug(`[BackendManager] Establishing connection to server...`);
      await this.connect(directory);
    }

    // Now get the executor (should be connected)
    return this.getCommandExecutor(directory);
  }

  /**
   * Set a custom backend instance (for testing).
   * This bypasses the normal OpenCodeBackend creation.
   */
  setBackendForTesting(backend: AgentBackend): void {
    this.backend = backend as OpenCodeBackend;
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
   * Clears the backend and resets initialization state.
   */
  resetForTesting(): void {
    this.backend = null;
    this.settings = getDefaultServerSettings();
    this.connectionError = null;
    this.initialized = false;
    this.testExecutorFactory = null;
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
