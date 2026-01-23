/**
 * Backend registry for Ralph Loops Management System.
 * Manages registration and lookup of agent backends.
 */

import type { AgentBackend, BackendFactory } from "./types";
import { log } from "../core/logger";

/**
 * Registry for agent backends.
 * Allows registering multiple backend implementations.
 */
class BackendRegistry {
  private factories = new Map<string, BackendFactory>();
  private instances = new Map<string, AgentBackend>();

  /**
   * Register a backend factory.
   * @param name - Backend name (e.g., "opencode")
   * @param factory - Factory function to create backend instances
   */
  register(name: string, factory: BackendFactory): void {
    this.factories.set(name, factory);
  }

  /**
   * Get or create a backend instance by name.
   * Returns undefined if not registered.
   */
  get(name: string): AgentBackend | undefined {
    // Return existing instance if available
    let instance = this.instances.get(name);
    if (instance) {
      return instance;
    }

    // Create new instance from factory
    const factory = this.factories.get(name);
    if (!factory) {
      return undefined;
    }

    instance = factory();
    this.instances.set(name, instance);
    return instance;
  }

  /**
   * List all registered backend names.
   */
  list(): string[] {
    return Array.from(this.factories.keys());
  }

  /**
   * Check if a backend is registered.
   */
  has(name: string): boolean {
    return this.factories.has(name);
  }

  /**
   * Unregister a backend and disconnect if connected.
   */
  async unregister(name: string): Promise<void> {
    const instance = this.instances.get(name);
    if (instance && instance.isConnected()) {
      await instance.disconnect();
    }
    this.instances.delete(name);
    this.factories.delete(name);
  }

  /**
   * Disconnect all backends and clear the registry.
   */
  async clear(): Promise<void> {
    for (const [name, instance] of this.instances) {
      if (instance.isConnected()) {
        try {
          await instance.disconnect();
        } catch (error) {
          log.error(`Error disconnecting backend ${name}:`, String(error));
        }
      }
    }
    this.instances.clear();
    this.factories.clear();
  }
}

/**
 * Global backend registry instance.
 */
export const backendRegistry = new BackendRegistry();

/**
 * Get a backend by name from the global registry.
 * Throws if not found.
 */
export function getBackend(name: string): AgentBackend {
  const backend = backendRegistry.get(name);
  if (!backend) {
    throw new Error(`Backend not found: ${name}. Available: ${backendRegistry.list().join(", ")}`);
  }
  return backend;
}

/**
 * Register a backend in the global registry.
 */
export function registerBackend(name: string, factory: BackendFactory): void {
  backendRegistry.register(name, factory);
}
