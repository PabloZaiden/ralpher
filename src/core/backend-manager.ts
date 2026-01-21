/**
 * Global backend manager for Ralph Loops Management System.
 * Manages a single global backend connection used by all loops.
 */

import { OpenCodeBackend } from "../backends/opencode";
import type { AgentBackend, BackendConnectionConfig } from "../backends/types";
import { getServerSettings, setServerSettings } from "../persistence/preferences";
import {
  DEFAULT_SERVER_SETTINGS,
  type ConnectionStatus,
  type ServerSettings,
} from "../types/settings";
import { loopEventEmitter } from "./event-emitter";
import type { LoopEvent } from "../types/events";

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
  private settings: ServerSettings = DEFAULT_SERVER_SETTINGS;
  private connectionError: string | null = null;
  private initialized = false;

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
   * Set a custom backend instance (for testing).
   * This bypasses the normal OpenCodeBackend creation.
   */
  setBackendForTesting(backend: AgentBackend): void {
    this.backend = backend as OpenCodeBackend;
    this.initialized = true;
  }

  /**
   * Reset the backend manager (for testing).
   * Clears the backend and resets initialization state.
   */
  resetForTesting(): void {
    this.backend = null;
    this.settings = DEFAULT_SERVER_SETTINGS;
    this.connectionError = null;
    this.initialized = false;
  }

  /**
   * Emit a server event.
   */
  private emitEvent(event: ServerEvent): void {
    // Cast to LoopEvent since the emitter accepts that type
    // The SSE handler will pass through any event with a type property
    loopEventEmitter.emit(event as unknown as LoopEvent);
  }
}

/**
 * Global backend manager singleton.
 */
export const backendManager = new BackendManager();
