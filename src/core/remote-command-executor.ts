/**
 * Command executor that runs all commands via PTY with WebSocket.
 * Works for both spawn mode (local opencode server) and connect mode (remote server).
 * 
 * For PTY-based command execution:
 * 1. Create a PTY session via REST API
 * 2. Connect to the PTY via WebSocket to capture output
 * 3. Wait for the command to complete and collect all output
 * 4. Clean up the PTY session
 * 
 * Commands are queued and executed one at a time to prevent overwhelming the server.
 */

import type { OpencodeClient } from "@opencode-ai/sdk";
import type { CommandExecutor, CommandResult, CommandOptions } from "./command-executor";

/** Log prefix for executor messages */
const LOG_PREFIX = "[CommandExecutor]";

/**
 * Configuration for the command executor.
 */
export interface CommandExecutorConfig {
  /** The opencode SDK client */
  client: OpencodeClient;
  /** The directory on the server */
  directory: string;
  /** Base URL for the opencode server (e.g., "http://localhost:4096") */
  baseUrl: string;
  /** Optional password for Basic auth */
  password?: string;
}

/**
 * CommandExecutorImpl runs commands on an opencode server via PTY.
 * Works for both spawn mode (local server) and connect mode (remote server).
 * 
 * All commands (including git) are executed via PTY with WebSocket output capture.
 * Commands are queued to ensure only one runs at a time.
 */
export class CommandExecutorImpl implements CommandExecutor {
  private client: OpencodeClient;
  private directory: string;
  private baseUrl: string;
  private password?: string;
  
  /** Queue of pending commands */
  private commandQueue: Array<{
    execute: () => Promise<CommandResult>;
    resolve: (result: CommandResult) => void;
    reject: (error: Error) => void;
  }> = [];
  
  /** Whether a command is currently executing */
  private isExecuting = false;

  constructor(config: CommandExecutorConfig) {
    this.client = config.client;
    this.directory = config.directory;
    this.baseUrl = config.baseUrl;
    this.password = config.password;
    console.log(`${LOG_PREFIX} Created executor for directory: ${config.directory}, baseUrl: ${config.baseUrl}`);
  }

  /**
   * Execute a shell command via PTY.
   * Commands are queued and executed one at a time.
   */
  async exec(command: string, args: string[], options?: CommandOptions): Promise<CommandResult> {
    const cmdStr = `${command} ${args.join(" ")}`;
    console.log(`${LOG_PREFIX} exec (queued): ${cmdStr}`);
    
    // Create a promise that will be resolved when the command completes
    return new Promise<CommandResult>((resolve, reject) => {
      const executeCommand = async (): Promise<CommandResult> => {
        console.log(`${LOG_PREFIX} exec (starting): ${cmdStr}`);
        const result = await this.execViaPty(command, args, options);
        if (result.success) {
          console.log(`${LOG_PREFIX} exec SUCCESS: ${cmdStr}`);
        } else {
          console.error(`${LOG_PREFIX} exec FAILED: ${cmdStr}`);
          console.error(`${LOG_PREFIX}   stderr: ${result.stderr || "(empty)"}`);
          console.error(`${LOG_PREFIX}   stdout: ${result.stdout.slice(0, 500)}${result.stdout.length > 500 ? "..." : ""}`);
        }
        return result;
      };
      
      // Add to queue
      this.commandQueue.push({ execute: executeCommand, resolve, reject });
      
      // Start processing if not already running
      this.processQueue();
    });
  }
  
  /**
   * Process the command queue, executing one command at a time.
   */
  private async processQueue(): Promise<void> {
    // If already executing, the current execution will pick up remaining items
    if (this.isExecuting) {
      return;
    }
    
    this.isExecuting = true;
    
    while (this.commandQueue.length > 0) {
      const item = this.commandQueue.shift();
      if (!item) break;
      
      try {
        const result = await item.execute();
        item.resolve(result);
      } catch (error) {
        item.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
    
    this.isExecuting = false;
  }

  /**
   * Execute a command via PTY with WebSocket output capture.
   * 
   * Flow:
   * 1. Create PTY session via REST API
   * 2. Connect to PTY via WebSocket
   * 3. Collect all output until the process exits
   * 4. Clean up the PTY session
   */
  private async execViaPty(command: string, args: string[], options?: CommandOptions): Promise<CommandResult> {
    const cwd = options?.cwd ?? this.directory;
    const timeout = options?.timeout ?? 30000;
    const cmdStr = `${command} ${args.join(" ")}`;

    console.log(`${LOG_PREFIX} PTY exec: ${cmdStr} in ${cwd} (timeout: ${timeout}ms)`);

    let ptyId: string | null = null;
    
    try {
      // 1. Create PTY session
      console.log(`${LOG_PREFIX} Creating PTY session...`);
      const createResult = await this.client.pty.create({
        body: {
          command,
          args,
          cwd,
          title: `ralpher-cmd-${Date.now()}`,
        },
        query: { directory: this.directory },
      });

      if (createResult.error) {
        const errMsg = `Failed to create PTY session: ${JSON.stringify(createResult.error)}`;
        console.error(`${LOG_PREFIX} ${errMsg}`);
        return {
          success: false,
          stdout: "",
          stderr: errMsg,
          exitCode: 1,
        };
      }

      ptyId = createResult.data?.id ?? null;
      if (!ptyId) {
        const errMsg = "PTY session created but no ID returned";
        console.error(`${LOG_PREFIX} ${errMsg}`);
        return {
          success: false,
          stdout: "",
          stderr: errMsg,
          exitCode: 1,
        };
      }

      console.log(`${LOG_PREFIX} PTY session created: ${ptyId}`);

      // 2. Small delay to ensure PTY is ready for WebSocket connection
      // This helps prevent "Expected 101 status code" errors
      await this.delay(50);

      // 3. Connect via WebSocket and collect output (with retry)
      console.log(`${LOG_PREFIX} Connecting to PTY via WebSocket...`);
      const result = await this.connectWithRetry(ptyId, timeout, cmdStr);

      return result;
    } catch (error) {
      const errMsg = String(error);
      console.error(`${LOG_PREFIX} PTY exec exception: ${errMsg}`);
      return {
        success: false,
        stdout: "",
        stderr: errMsg,
        exitCode: 1,
      };
    } finally {
      // 4. Clean up the PTY session
      if (ptyId) {
        console.log(`${LOG_PREFIX} Cleaning up PTY session: ${ptyId}`);
        await this.client.pty.remove({
          path: { id: ptyId },
          query: { directory: this.directory },
        }).catch((err) => {
          console.warn(`${LOG_PREFIX} Failed to cleanup PTY session ${ptyId}: ${String(err)}`);
        });
      }
    }
  }

  /**
   * Helper to delay execution.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Connect to PTY with retry logic for transient connection failures.
   * Retries up to 3 times with exponential backoff.
   */
  private async connectWithRetry(ptyId: string, timeout: number, cmdStr: string): Promise<CommandResult> {
    const maxRetries = 3;
    const baseDelay = 100; // ms
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const result = await this.connectAndCollectOutput(ptyId, timeout, cmdStr);
      
      // If successful or not a connection error, return immediately
      if (result.success || !result.stderr?.includes("WebSocket connection error")) {
        return result;
      }
      
      // If this was a WebSocket connection error and we have retries left
      if (attempt < maxRetries) {
        const delayMs = baseDelay * Math.pow(2, attempt - 1); // 100, 200, 400
        console.log(`${LOG_PREFIX} WebSocket connection failed, retrying in ${delayMs}ms (attempt ${attempt}/${maxRetries})...`);
        await this.delay(delayMs);
      } else {
        console.error(`${LOG_PREFIX} WebSocket connection failed after ${maxRetries} attempts`);
        return result;
      }
    }
    
    // Should never reach here, but TypeScript needs it
    return {
      success: false,
      stdout: "",
      stderr: "Max retries exceeded",
      exitCode: 1,
    };
  }

  /**
   * Connect to a PTY session via WebSocket and collect all output.
   */
  private async connectAndCollectOutput(ptyId: string, timeout: number, cmdStr: string): Promise<CommandResult> {
    return new Promise((resolve) => {
      // Build WebSocket URL
      const wsUrl = this.buildWebSocketUrl(ptyId);
      console.log(`${LOG_PREFIX} WebSocket URL: ${wsUrl.replace(/auth=[^&]+/, "auth=***")}`);
      
      let output = "";
      let exitCode = 0;
      let resolved = false;
      let ws: WebSocket | null = null;

      const cleanup = () => {
        if (ws) {
          try {
            ws.close();
          } catch {
            // Ignore close errors
          }
          ws = null;
        }
      };

      const resolveOnce = (result: CommandResult) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(result);
        }
      };

      // Set timeout
      const timeoutId = setTimeout(() => {
        console.error(`${LOG_PREFIX} Command timed out after ${timeout}ms: ${cmdStr}`);
        resolveOnce({
          success: false,
          stdout: output,
          stderr: "Command timed out",
          exitCode: 124, // Standard timeout exit code
        });
      }, timeout);

      try {
        // Create WebSocket connection with auth headers
        // Bun's WebSocket supports custom headers (unlike browser WebSocket)
        const wsOptions: { headers?: Record<string, string> } = {};
        if (this.password) {
          const credentials = Buffer.from(`opencode:${this.password}`).toString("base64");
          wsOptions.headers = {
            Authorization: `Basic ${credentials}`,
          };
        }

        ws = new WebSocket(wsUrl, wsOptions as ConstructorParameters<typeof WebSocket>[1]);

        ws.onopen = () => {
          console.log(`${LOG_PREFIX} WebSocket connected for PTY: ${ptyId}`);
        };

        ws.onmessage = (event) => {
          // Collect terminal output
          const data = typeof event.data === "string" ? event.data : event.data.toString();
          output += data;
        };

        ws.onclose = async (event) => {
          console.log(`${LOG_PREFIX} WebSocket closed for PTY: ${ptyId} (code: ${event.code}, reason: ${event.reason || "none"})`);
          clearTimeout(timeoutId);
          
          // Get final PTY status to determine exit code
          try {
            const statusResult = await this.client.pty.get({
              path: { id: ptyId },
              query: { directory: this.directory },
            });
            
            if (!statusResult.error && statusResult.data) {
              const ptyInfo = statusResult.data;
              console.log(`${LOG_PREFIX} PTY status: ${ptyInfo.status}`);
              if (ptyInfo.status === "exited") {
                exitCode = 0; // Default to success if PTY exited cleanly
              }
            }
          } catch (err) {
            console.warn(`${LOG_PREFIX} Failed to get PTY status: ${String(err)}`);
          }

          // Determine success based on output patterns
          const hasError = this.detectErrorInOutput(output);
          if (hasError) {
            console.warn(`${LOG_PREFIX} Error pattern detected in output for: ${cmdStr}`);
          }
          
          console.log(`${LOG_PREFIX} Command completed: ${cmdStr} (success: ${!hasError}, outputLen: ${output.length})`);
          
          resolveOnce({
            success: !hasError && exitCode === 0,
            stdout: output,
            stderr: "", // PTY combines stdout/stderr
            exitCode: hasError ? 1 : exitCode,
          });
        };

        ws.onerror = (event) => {
          console.error(`${LOG_PREFIX} WebSocket error for PTY: ${ptyId}`, event);
          clearTimeout(timeoutId);
          resolveOnce({
            success: false,
            stdout: output,
            stderr: "WebSocket connection error",
            exitCode: 1,
          });
        };
      } catch (error) {
        console.error(`${LOG_PREFIX} Failed to create WebSocket: ${String(error)}`);
        clearTimeout(timeoutId);
        resolveOnce({
          success: false,
          stdout: "",
          stderr: `Failed to connect to PTY: ${String(error)}`,
          exitCode: 1,
        });
      }
    });
  }

  /**
   * Build the WebSocket URL for connecting to a PTY session.
   */
  private buildWebSocketUrl(ptyId: string): string {
    // Convert HTTP URL to WebSocket URL
    const wsProtocol = this.baseUrl.startsWith("https") ? "wss" : "ws";
    const wsBaseUrl = this.baseUrl.replace(/^https?/, wsProtocol);
    return `${wsBaseUrl}/pty/${ptyId}/connect?directory=${encodeURIComponent(this.directory)}`;
  }

  /**
   * Detect common error patterns in command output.
   * This is used as a heuristic when we can't get the actual exit code.
   */
  private detectErrorInOutput(output: string): boolean {
    const errorPatterns = [
      /^fatal:/m,           // Git fatal errors
      /^error:/m,           // Generic error prefix
      /^Error:/m,           // Capitalized error prefix
      /command not found/i, // Command not found
      /permission denied/i, // Permission errors
      /^FATAL:/m,           // Uppercase fatal
      /^ERROR:/m,           // Uppercase error
    ];

    for (const pattern of errorPatterns) {
      if (pattern.test(output)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a file exists on the server.
   * Uses REST API (not PTY), so doesn't need to be queued.
   */
  async fileExists(path: string): Promise<boolean> {
    console.log(`${LOG_PREFIX} fileExists: ${path}`);
    try {
      const result = await this.client.file.read({
        query: {
          directory: this.directory,
          path,
        },
      });
      const exists = !result.error;
      console.log(`${LOG_PREFIX} fileExists: ${path} = ${exists}`);
      return exists;
    } catch (err) {
      console.error(`${LOG_PREFIX} fileExists error for ${path}: ${String(err)}`);
      return false;
    }
  }

  /**
   * Check if a directory exists on the server.
   * Uses REST API (not PTY), so doesn't need to be queued.
   */
  async directoryExists(path: string): Promise<boolean> {
    console.log(`${LOG_PREFIX} directoryExists: ${path}`);
    try {
      const result = await this.client.file.list({
        query: {
          directory: this.directory,
          path,
        },
      });
      const exists = !result.error;
      console.log(`${LOG_PREFIX} directoryExists: ${path} = ${exists}`);
      return exists;
    } catch (err) {
      console.error(`${LOG_PREFIX} directoryExists error for ${path}: ${String(err)}`);
      return false;
    }
  }

  /**
   * Read a file's contents from the server.
   * Uses REST API (not PTY), so doesn't need to be queued.
   */
  async readFile(path: string): Promise<string | null> {
    console.log(`${LOG_PREFIX} readFile: ${path}`);
    try {
      const result = await this.client.file.read({
        query: {
          directory: this.directory,
          path,
        },
      });

      if (result.error) {
        console.warn(`${LOG_PREFIX} readFile error for ${path}: ${JSON.stringify(result.error)}`);
        return null;
      }

      // The file.read endpoint returns FileContent which has a content field
      const data = result.data as { type: string; content: string };
      if (data?.type === "text") {
        console.log(`${LOG_PREFIX} readFile: ${path} = ${data.content.length} bytes`);
        return data.content;
      }

      console.warn(`${LOG_PREFIX} readFile: ${path} has unexpected type: ${data?.type}`);
      return null;
    } catch (err) {
      console.error(`${LOG_PREFIX} readFile exception for ${path}: ${String(err)}`);
      return null;
    }
  }

  /**
   * List files in a directory on the server.
   * Uses REST API (not PTY), so doesn't need to be queued.
   */
  async listDirectory(path: string): Promise<string[]> {
    console.log(`${LOG_PREFIX} listDirectory: ${path}`);
    try {
      const result = await this.client.file.list({
        query: {
          directory: this.directory,
          path,
        },
      });

      if (result.error) {
        console.warn(`${LOG_PREFIX} listDirectory error for ${path}: ${JSON.stringify(result.error)}`);
        return [];
      }

      // The file.list endpoint returns FileNode[] which has name property
      const data = result.data as Array<{ name: string }>;
      const files = data?.map((f) => f.name) ?? [];
      console.log(`${LOG_PREFIX} listDirectory: ${path} = ${files.length} files`);
      return files;
    } catch (err) {
      console.error(`${LOG_PREFIX} listDirectory exception for ${path}: ${String(err)}`);
      return [];
    }
  }
}

/**
 * Backward-compatible aliases.
 * @deprecated Use CommandExecutorImpl and CommandExecutorConfig instead
 */
export { CommandExecutorImpl as RemoteCommandExecutor };
export type { CommandExecutorConfig as RemoteCommandExecutorConfig };
