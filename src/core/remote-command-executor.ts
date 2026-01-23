/**
 * Command executor that runs all commands via PTY with WebSocket.
 * Works for both spawn mode (local opencode server) and connect mode (remote server).
 * 
 * For PTY-based command execution:
 * 1. Create a PTY session via REST API
 * 2. Connect to the PTY via WebSocket to capture output
 * 3. Send command with unique markers to delimit output
 * 4. Wait for the command to complete and extract clean output
 * 5. Clean up the PTY session
 * 
 * Commands are queued and executed one at a time to prevent overwhelming the server.
 */

import type { OpencodeClient } from "@opencode-ai/sdk/v2";
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
  /** Auth headers for connections (same as used for SDK client) */
  authHeaders: Record<string, string>;
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
  private authHeaders: Record<string, string>;

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
    this.authHeaders = config.authHeaders;
  }

  /**
   * Execute a shell command via PTY.
   * Commands are queued and executed one at a time.
   */
  async exec(command: string, args: string[], options?: CommandOptions): Promise<CommandResult> {
    const cmdStr = `${command} ${args.join(" ")}`;

    // Create a promise that will be resolved when the command completes
    return new Promise<CommandResult>((resolve, reject) => {
      const executeCommand = async (): Promise<CommandResult> => {
        const result = await this.execViaPty(command, args, options);
        if (!result.success) {
          console.error(`${LOG_PREFIX} Command failed: ${cmdStr}`);
          console.error(`${LOG_PREFIX}   exitCode: ${result.exitCode}`);
          if (result.stderr) {
            console.error(`${LOG_PREFIX}   stderr: ${result.stderr}`);
          }
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
   * 1. Create PTY shell session (without command)
   * 2. Connect via WebSocket
   * 3. Send command with markers to delimit output
   * 4. Collect output and extract content between markers
   * 5. Clean up PTY session
   */
  private async execViaPty(command: string, args: string[], options?: CommandOptions): Promise<CommandResult> {
    const cwd = options?.cwd ?? this.directory;
    const timeout = options?.timeout ?? 30000;
    let ptyId: string | null = null;

    try {
      // Create PTY session WITHOUT command - creates a persistent shell
      // IMPORTANT: Must pass `directory` to scope PTY to the correct Instance context
      const createResult = await this.client.pty.create({
        directory: this.directory,
        cwd,
        title: `ralpher-cmd-${Date.now()}`,
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

      // Connect via WebSocket and send command
      return await this.executeCommandViaPty(ptyId, command, args, timeout);
    } catch (error) {
      return {
        success: false,
        stdout: "",
        stderr: String(error),
        exitCode: 1,
      };
    } finally {
      // Clean up the PTY session
      if (ptyId) {
        await this.client.pty.remove({
          ptyID: ptyId,
          directory: this.directory,
        }).catch(() => {
          // Ignore cleanup errors
        });
      }
    }
  }

  /**
   * Connect to PTY via WebSocket, send command, and collect output.
   * Uses start/end markers to extract clean output from PTY noise.
   */
  private executeCommandViaPty(
    ptyId: string,
    command: string,
    args: string[],
    timeout: number
  ): Promise<CommandResult> {
    return new Promise((resolve) => {
      const wsUrl = this.buildWebSocketUrl(ptyId);

      // Create unique markers to delimit command output
      const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const startMarker = `__RALPHER_START_${uniqueId}__`;
      const endMarker = `__RALPHER_END_${uniqueId}__`;
      
      let output = "";
      let resolved = false;
      let ws: WebSocket | null = null;
      let commandSent = false;

      const cleanup = () => {
        if (ws) {
          try { ws.close(); } catch { /* ignore */ }
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

      const timeoutId = setTimeout(() => {
        resolveOnce({
          success: false,
          stdout: output,
          stderr: "Command timed out",
          exitCode: 124,
        });
      }, timeout);

      try {
        const wsOptions: { headers?: Record<string, string> } = {};
        if (Object.keys(this.authHeaders).length > 0) {
          wsOptions.headers = { ...this.authHeaders };
        }

        ws = new WebSocket(wsUrl, wsOptions as ConstructorParameters<typeof WebSocket>[1]);

        ws.onopen = () => {
          // Build command with clean environment and markers
          // IMPORTANT: Use 'export' for env vars so child processes (like git) inherit them.
          // Without export, git running in a PTY would use its default pager (like 'less'),
          // which waits for keyboard input and causes commands to timeout.
          const escapedArgs = args.map(a => this.shellEscape(a)).join(" ");
          const fullCommand = [
            "stty -echo 2>/dev/null",
            'export PS1=""',
            'export PS2=""',
            'export PROMPT_COMMAND=""',
            "export GIT_PAGER=cat",
            "export GIT_TERMINAL_PROMPT=0",
            "export PAGER=cat",
            "export TERM=dumb",
            `echo "${startMarker}"`,
            `${command} ${escapedArgs}`,
            `__ec=$?; echo ""; echo "${endMarker}:$__ec"`,
          ].join("; ");
          
          if (ws) {
            ws.send(fullCommand + "\n");
            commandSent = true;
          }
        };

        ws.onmessage = (event) => {
          const data = typeof event.data === "string" ? event.data : event.data.toString();
          output += data;
          
          // Check for end marker
          const endMarkerMatch = output.match(new RegExp(`^${endMarker}:(\\d+)`, "m"));
          if (endMarkerMatch && endMarkerMatch[1] && commandSent) {
            clearTimeout(timeoutId);
            
            const exitCode = parseInt(endMarkerMatch[1], 10);
            const cleanOutput = this.extractOutputBetweenMarkers(output, startMarker, endMarker);
            
            resolveOnce({
              success: exitCode === 0,
              stdout: cleanOutput,
              stderr: "",
              exitCode,
            });
          }
        };

        ws.onclose = () => {
          clearTimeout(timeoutId);
          if (!resolved) {
            const hasError = this.detectErrorInOutput(output);
            resolveOnce({
              success: !hasError,
              stdout: output,
              stderr: "",
              exitCode: hasError ? 1 : 0,
            });
          }
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
   * Extract output between start and end markers.
   * The PTY echoes commands back, so markers appear twice - we use lastIndexOf
   * to find the actual output from the echo commands.
   */
  private extractOutputBetweenMarkers(output: string, startMarker: string, endMarker: string): string {
    // Find the LAST occurrence of markers (actual echo output, not command echo)
    const startMarkerWithNewline = startMarker + "\r\n";
    const lastStartIndex = output.lastIndexOf(startMarkerWithNewline);
    const lastEndIndex = output.lastIndexOf(endMarker + ":");

    if (lastStartIndex !== -1 && lastEndIndex !== -1 && lastEndIndex > lastStartIndex) {
      const contentStart = lastStartIndex + startMarkerWithNewline.length;
      return output.slice(contentStart, lastEndIndex).trim();
    }

    // Fallback: try with just newline
    const startAfterNewline = output.lastIndexOf("\n" + startMarker);
    const endAfterNewline = output.lastIndexOf("\n" + endMarker);

    if (startAfterNewline !== -1 && endAfterNewline !== -1 && endAfterNewline > startAfterNewline) {
      const contentStart = startAfterNewline + 1 + startMarker.length;
      return output.slice(contentStart, endAfterNewline).trim();
    }

    // Last resort: use first occurrence
    const startIndex = output.indexOf(startMarker);
    const endIndex = output.indexOf(endMarker);

    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
      return output.slice(startIndex + startMarker.length, endIndex).trim();
    }

    return "";
  }

  /**
   * Escape a string for use in a shell command.
   */
  private shellEscape(arg: string): string {
    if (/[^a-zA-Z0-9_\-./=]/.test(arg)) {
      return "'" + arg.replace(/'/g, "'\"'\"'") + "'";
    }
    return arg;
  }

  /**
   * Build the WebSocket URL for connecting to a PTY session.
   */
  private buildWebSocketUrl(ptyId: string): string {
    const wsProtocol = this.baseUrl.startsWith("https") ? "wss" : "ws";
    const wsBaseUrl = this.baseUrl.replace(/^https?/, wsProtocol);
    const encodedDirectory = encodeURIComponent(this.directory);
    return `${wsBaseUrl}/pty/${ptyId}/connect?directory=${encodedDirectory}`;
  }

  /**
   * Detect common error patterns in command output.
   */
  private detectErrorInOutput(output: string): boolean {
    const errorPatterns = [
      /^fatal:/m,
      /^error:/m,
      /^Error:/m,
      /command not found/i,
      /permission denied/i,
      /^FATAL:/m,
      /^ERROR:/m,
    ];

    return errorPatterns.some(pattern => pattern.test(output));
  }

  /**
   * Check if a file exists on the server.
   * Uses `test -f` via PTY for reliable cross-mode operation.
   */
  async fileExists(path: string): Promise<boolean> {
    const result = await this.exec("test", ["-f", path]);
    return result.success;
  }

  /**
   * Check if a directory exists on the server.
   * Uses `test -d` via PTY for reliable cross-mode operation.
   */
  async directoryExists(path: string): Promise<boolean> {
    const result = await this.exec("test", ["-d", path]);
    return result.success;
  }

  /**
   * Read a file's contents from the server.
   * Uses `cat` via PTY for reliable cross-mode operation.
   */
  async readFile(path: string): Promise<string | null> {
    const result = await this.exec("cat", [path]);
    if (result.success) {
      return result.stdout;
    }
    return null;
  }

  /**
   * List files in a directory on the server.
   * Uses `ls -1` via PTY for reliable cross-mode operation.
   */
  async listDirectory(path: string): Promise<string[]> {
    const result = await this.exec("ls", ["-1", path]);
    if (result.success && result.stdout.trim()) {
      return result.stdout.trim().split("\n").filter(Boolean);
    }
    return [];
  }
}

/**
 * Backward-compatible aliases.
 * @deprecated Use CommandExecutorImpl and CommandExecutorConfig instead
 */
export { CommandExecutorImpl as RemoteCommandExecutor };
export type { CommandExecutorConfig as RemoteCommandExecutorConfig };
