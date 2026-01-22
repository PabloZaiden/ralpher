/**
 * Remote command executor for connect mode.
 * Uses the opencode SDK's VCS/file APIs where available, and PTY with WebSocket for shell commands.
 * 
 * For PTY-based command execution:
 * 1. Create a PTY session via REST API
 * 2. Connect to the PTY via WebSocket to capture output
 * 3. Wait for the command to complete and collect all output
 * 4. Clean up the PTY session
 */

import type { OpencodeClient } from "@opencode-ai/sdk";
import type { CommandExecutor, CommandResult, CommandOptions } from "./command-executor";

/**
 * Configuration for the remote command executor.
 */
export interface RemoteCommandExecutorConfig {
  /** The opencode SDK client */
  client: OpencodeClient;
  /** The directory on the remote server */
  directory: string;
  /** Base URL for the opencode server (e.g., "http://localhost:4096") */
  baseUrl: string;
  /** Optional password for Basic auth */
  password?: string;
}

/**
 * RemoteCommandExecutor runs commands on a remote opencode server.
 * Used when Ralpher is running in connect mode (code is on remote machine).
 */
export class RemoteCommandExecutor implements CommandExecutor {
  private client: OpencodeClient;
  private directory: string;
  private baseUrl: string;
  private password?: string;

  constructor(config: RemoteCommandExecutorConfig) {
    this.client = config.client;
    this.directory = config.directory;
    this.baseUrl = config.baseUrl;
    this.password = config.password;
  }

  /**
   * Execute a shell command on the remote server.
   * 
   * For git queries, we use the SDK's VCS and file APIs for efficiency.
   * For other commands, we use PTY-based execution with WebSocket output capture.
   */
  async exec(command: string, args: string[], options?: CommandOptions): Promise<CommandResult> {
    // Handle common git commands using SDK APIs
    if (command === "git") {
      return this.execGitCommand(args, options);
    }

    // For non-git commands, use PTY with WebSocket
    return this.execViaPty(command, args, options);
  }

  /**
   * Execute git commands using SDK APIs where possible.
   */
  private async execGitCommand(args: string[], options?: CommandOptions): Promise<CommandResult> {
    // Filter out -C flag and directory from args (we use the directory from config)
    const filteredArgs = this.filterGitArgs(args);
    const subcommand = filteredArgs[0];

    // git rev-parse --abbrev-ref HEAD -> get current branch
    if (subcommand === "rev-parse" && filteredArgs.includes("--abbrev-ref") && filteredArgs.includes("HEAD")) {
      try {
        const result = await this.client.vcs.get({
          query: { directory: this.directory },
        });
        if (result.error) {
          return {
            success: false,
            stdout: "",
            stderr: JSON.stringify(result.error),
            exitCode: 1,
          };
        }
        const branch = (result.data as { branch: string })?.branch ?? "";
        return {
          success: true,
          stdout: branch + "\n",
          stderr: "",
          exitCode: 0,
        };
      } catch (error) {
        return {
          success: false,
          stdout: "",
          stderr: String(error),
          exitCode: 1,
        };
      }
    }

    // git rev-parse --is-inside-work-tree -> check if git repo
    if (subcommand === "rev-parse" && filteredArgs.includes("--is-inside-work-tree")) {
      try {
        const result = await this.client.vcs.get({
          query: { directory: this.directory },
        });
        if (result.error) {
          return {
            success: false,
            stdout: "",
            stderr: "Not a git repository",
            exitCode: 1,
          };
        }
        return {
          success: true,
          stdout: "true\n",
          stderr: "",
          exitCode: 0,
        };
      } catch {
        return {
          success: false,
          stdout: "",
          stderr: "Not a git repository",
          exitCode: 1,
        };
      }
    }

    // git status --porcelain -> get changed files
    if (subcommand === "status" && filteredArgs.includes("--porcelain")) {
      try {
        const result = await this.client.file.status({
          query: { directory: this.directory },
        });
        if (result.error) {
          return {
            success: false,
            stdout: "",
            stderr: JSON.stringify(result.error),
            exitCode: 1,
          };
        }
        // Convert file status to porcelain format
        const files = result.data as Array<{ path: string; status: string }> ?? [];
        const output = files.map((f) => {
          const statusChar = f.status === "added" ? "A" : f.status === "deleted" ? "D" : "M";
          return ` ${statusChar} ${f.path}`;
        }).join("\n");
        return {
          success: true,
          stdout: output ? output + "\n" : "",
          stderr: "",
          exitCode: 0,
        };
      } catch (error) {
        return {
          success: false,
          stdout: "",
          stderr: String(error),
          exitCode: 1,
        };
      }
    }

    // For other git commands, use PTY with WebSocket
    return this.execViaPty("git", args, options);
  }

  /**
   * Filter out -C flag and directory from git args.
   * The -C flag is used by GitService to specify directory, but we handle that via config.
   */
  private filterGitArgs(args: string[]): string[] {
    const filtered: string[] = [];
    let skipNext = false;
    
    for (const arg of args) {
      if (skipNext) {
        skipNext = false;
        continue;
      }
      if (arg === "-C") {
        skipNext = true;
        continue;
      }
      filtered.push(arg);
    }
    
    return filtered;
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

    let ptyId: string | null = null;
    
    try {
      // 1. Create PTY session
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
        return {
          success: false,
          stdout: "",
          stderr: `Failed to create PTY session: ${JSON.stringify(createResult.error)}`,
          exitCode: 1,
        };
      }

      ptyId = createResult.data?.id ?? null;
      if (!ptyId) {
        return {
          success: false,
          stdout: "",
          stderr: "PTY session created but no ID returned",
          exitCode: 1,
        };
      }

      // 2. Connect via WebSocket and collect output
      const result = await this.connectAndCollectOutput(ptyId, timeout);

      return result;
    } catch (error) {
      return {
        success: false,
        stdout: "",
        stderr: String(error),
        exitCode: 1,
      };
    } finally {
      // 3. Clean up the PTY session
      if (ptyId) {
        await this.client.pty.remove({
          path: { id: ptyId },
          query: { directory: this.directory },
        }).catch(() => {
          // Ignore cleanup errors
        });
      }
    }
  }

  /**
   * Connect to a PTY session via WebSocket and collect all output.
   */
  private async connectAndCollectOutput(ptyId: string, timeout: number): Promise<CommandResult> {
    return new Promise((resolve) => {
      // Build WebSocket URL
      const wsUrl = this.buildWebSocketUrl(ptyId);
      
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
        resolveOnce({
          success: false,
          stdout: output,
          stderr: "Command timed out",
          exitCode: 124, // Standard timeout exit code
        });
      }, timeout);

      try {
        // Create WebSocket connection
        // Note: Browser WebSocket doesn't support custom headers, so we add auth via query param if needed
        const wsUrlWithAuth = this.password 
          ? `${wsUrl}&auth=${encodeURIComponent(Buffer.from(`opencode:${this.password}`).toString("base64"))}`
          : wsUrl;

        ws = new WebSocket(wsUrlWithAuth);

        ws.onopen = () => {
          // Connection established - PTY is running
        };

        ws.onmessage = (event) => {
          // Collect terminal output
          const data = typeof event.data === "string" ? event.data : event.data.toString();
          output += data;
          
          // Check for exit code in output (some terminals output this)
          // We'll also check via polling as a fallback
        };

        ws.onclose = async () => {
          // WebSocket closed - check if PTY exited
          clearTimeout(timeoutId);
          
          // Get final PTY status to determine exit code
          try {
            const statusResult = await this.client.pty.get({
              path: { id: ptyId },
              query: { directory: this.directory },
            });
            
            if (!statusResult.error && statusResult.data) {
              const ptyInfo = statusResult.data;
              if (ptyInfo.status === "exited") {
                // Try to extract exit code from the response
                // The PTY info might include exit code in extended properties
                exitCode = 0; // Default to success if PTY exited cleanly
              }
            }
          } catch {
            // Ignore status check errors - PTY might already be cleaned up
          }

          // Determine success based on output patterns
          // For git commands, we can check for common error patterns
          const hasError = this.detectErrorInOutput(output);
          
          resolveOnce({
            success: !hasError && exitCode === 0,
            stdout: output,
            stderr: "", // PTY combines stdout/stderr
            exitCode: hasError ? 1 : exitCode,
          });
        };

        ws.onerror = () => {
          clearTimeout(timeoutId);
          resolveOnce({
            success: false,
            stdout: output,
            stderr: "WebSocket connection error",
            exitCode: 1,
          });
        };
      } catch (error) {
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
   * Check if a file exists on the remote server.
   */
  async fileExists(path: string): Promise<boolean> {
    try {
      const result = await this.client.file.read({
        query: {
          directory: this.directory,
          path,
        },
      });
      // If we can read it, it exists
      return !result.error;
    } catch {
      return false;
    }
  }

  /**
   * Check if a directory exists on the remote server.
   */
  async directoryExists(path: string): Promise<boolean> {
    try {
      const result = await this.client.file.list({
        query: {
          directory: this.directory,
          path,
        },
      });
      // If we can list it, it exists and is a directory
      return !result.error;
    } catch {
      return false;
    }
  }

  /**
   * Read a file's contents from the remote server.
   */
  async readFile(path: string): Promise<string | null> {
    try {
      const result = await this.client.file.read({
        query: {
          directory: this.directory,
          path,
        },
      });

      if (result.error) {
        return null;
      }

      // The file.read endpoint returns FileContent which has a content field
      const data = result.data as { type: string; content: string };
      if (data?.type === "text") {
        return data.content;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * List files in a directory on the remote server.
   */
  async listDirectory(path: string): Promise<string[]> {
    try {
      const result = await this.client.file.list({
        query: {
          directory: this.directory,
          path,
        },
      });

      if (result.error) {
        return [];
      }

      // The file.list endpoint returns FileNode[] which has name property
      const data = result.data as Array<{ name: string }>;
      return data?.map((f) => f.name) ?? [];
    } catch {
      return [];
    }
  }
}
