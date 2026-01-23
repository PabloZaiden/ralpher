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
    console.log(`${LOG_PREFIX} Created executor for directory: ${config.directory}, baseUrl: ${config.baseUrl}, hasAuth: ${Object.keys(config.authHeaders).length > 0}`);
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
   * Retries with a new PTY session if WebSocket connection fails.
   * 
   * Flow:
   * 1. Create PTY session via REST API
   * 2. Connect to PTY via WebSocket
   * 3. Collect all output until the process exits
   * 4. Clean up the PTY session
   * 5. If WebSocket failed, retry with new PTY session
   */
  private async execViaPty(command: string, args: string[], options?: CommandOptions): Promise<CommandResult> {
    const cwd = options?.cwd ?? this.directory;
    const timeout = options?.timeout ?? 30000;
    const cmdStr = `${command} ${args.join(" ")}`;
    const maxRetries = 1;
    const baseDelay = 100; // ms

    console.log(`${LOG_PREFIX} PTY exec: ${cmdStr} in ${cwd} (timeout: ${timeout}ms)`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const result = await this.execViaPtyOnce(command, args, cwd, timeout, cmdStr);

      // If successful or not a WebSocket connection error, return immediately
      if (result.success || !result.stderr?.includes("WebSocket connection error")) {
        return result;
      }

      // If this was a WebSocket connection error and we have retries left
      if (attempt < maxRetries) {
        const delayMs = baseDelay * Math.pow(2, attempt - 1); // 100, 200, 400
        console.log(`${LOG_PREFIX} PTY/WebSocket failed, retrying with new PTY in ${delayMs}ms (attempt ${attempt}/${maxRetries})...`);
        await this.delay(delayMs);
      } else {
        console.error(`${LOG_PREFIX} PTY execution failed after ${maxRetries} attempts`);
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
   * Execute a command via PTY once (single attempt).
   * 
   * The correct flow for PTY command execution:
   * 1. Create PTY with just cwd/title (NO command) - creates a persistent shell
   * 2. Connect via WebSocket immediately
   * 3. Send the command through WebSocket
   * 4. Wait for output and detect command completion
   * 5. Close WebSocket and cleanup PTY
   */
  private async execViaPtyOnce(
    command: string,
    args: string[],
    cwd: string,
    timeout: number,
    cmdStr: string
  ): Promise<CommandResult> {
    let ptyId: string | null = null;

    try {
      // Log the directory context for debugging
      console.log(`${LOG_PREFIX} PTY operation - cwd: "${cwd}"`);

      // 1. Create PTY session WITHOUT command - this creates a persistent shell
      // If we pass command, it runs immediately and the PTY closes before we can connect
      // IMPORTANT: Must pass `directory` to scope PTY to the correct Instance context
      console.log(`${LOG_PREFIX} Creating PTY shell session...`);
      const createResult = await this.client.pty.create({
        directory: this.directory, // Required for Instance scoping
        cwd,
        title: `ralpher-cmd-${Date.now()}`,
        // Note: NOT passing command/args - we'll send them via WebSocket
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

      console.log(`${LOG_PREFIX} PTY shell session created: ${ptyId}`);

      // 2. Connect via WebSocket and send command
      console.log(`${LOG_PREFIX} Connecting to PTY via WebSocket and sending command...`);
      const result = await this.connectSendCommandAndCollectOutput(ptyId, command, args, timeout, cmdStr);

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
      // 3. Clean up the PTY session
      if (ptyId) {
        console.log(`${LOG_PREFIX} Cleaning up PTY session: ${ptyId}`);
        await this.client.pty.remove({
          ptyID: ptyId,
          directory: this.directory, // Required for Instance scoping
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
   * Connect to a PTY session via WebSocket, send command, and collect output.
   * 
   * This method:
   * 1. Connects to the PTY shell via WebSocket
   * 2. Sends a clean environment setup + command wrapped with start/end markers
   * 3. Collects output and extracts only the content between the markers
   * 4. Returns the clean command output
   * 
   * The key insight is that the PTY inherits the server's shell environment,
   * which includes prompts, welcome messages, etc. We use start/end markers
   * to cleanly delimit the actual command output from all the shell noise.
   */
  private async connectSendCommandAndCollectOutput(
    ptyId: string,
    command: string,
    args: string[],
    timeout: number,
    cmdStr: string
  ): Promise<CommandResult> {
    return new Promise((resolve) => {
      // Build WebSocket URL
      const wsUrl = this.buildWebSocketUrl(ptyId);
      console.log(`${LOG_PREFIX} WebSocket URL: ${wsUrl.replace(/auth=[^&]+/, "auth=***")}`);

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
        if (Object.keys(this.authHeaders).length > 0) {
          wsOptions.headers = { ...this.authHeaders };
        }

        ws = new WebSocket(wsUrl, wsOptions as ConstructorParameters<typeof WebSocket>[1]);

        ws.onopen = () => {
          console.log(`${LOG_PREFIX} WebSocket connected for PTY: ${ptyId}`);
          
          // Build the command with clean environment and output markers.
          // 
          // Strategy:
          // 1. Disable terminal echo (stty -echo) to prevent command echo
          // 2. Disable shell prompt (PS1="") to prevent prompt pollution
          // 3. Set environment variables to ensure non-interactive execution
          // 4. Echo a unique START marker (on its own line)
          // 5. Run the actual command
          // 6. Capture exit code immediately after command
          // 7. Echo a unique END marker with the exit code (on its own line)
          // 
          // This way we can extract exactly what's between START and END markers.
          const escapedArgs = args.map(a => this.shellEscape(a)).join(" ");
          const fullCommand = [
            // Disable terminal echo to prevent command being echoed back
            "stty -echo 2>/dev/null",
            // Disable prompt and set clean environment
            'PS1=""',
            'PS2=""',
            'PROMPT_COMMAND=""',
            "GIT_PAGER=cat",
            "GIT_TERMINAL_PROMPT=0",
            "PAGER=cat",
            "TERM=dumb",
            // Start marker on its own line
            `echo "${startMarker}"`,
            // The actual command
            `${command} ${escapedArgs}`,
            // Capture exit code and end marker on its own line
            `__ec=$?; echo ""; echo "${endMarker}:$__ec"`,
          ].join("; ");
          
          console.log(`${LOG_PREFIX} Sending command: ${cmdStr}`);
          
          if (ws) {
            ws.send(fullCommand + "\n");
            commandSent = true;
          }
        };

        ws.onmessage = (event) => {
          // Collect terminal output
          const data = typeof event.data === "string" ? event.data : event.data.toString();
          output += data;
          
          // Check if we see our end marker (command completed)
          // The marker should appear at the start of a line (from our echo command)
          const endMarkerMatch = output.match(new RegExp(`^${endMarker}:(\\d+)`, "m"));
          const exitCodeStr = endMarkerMatch?.[1];
          if (exitCodeStr && commandSent) {
            clearTimeout(timeoutId);
            
            const exitCode = parseInt(exitCodeStr, 10);
            console.log(`${LOG_PREFIX} Command completed with exit code: ${exitCode}`);
            
            // Debug: Log raw PTY output for troubleshooting
            console.log(`${LOG_PREFIX} Raw PTY output (${output.length} bytes):`);
            console.log(`${LOG_PREFIX} --- RAW OUTPUT START ---`);
            console.log(JSON.stringify(output));
            console.log(`${LOG_PREFIX} --- RAW OUTPUT END ---`);
            
            // Extract only the content between start and end markers.
            // 
            // IMPORTANT: The PTY echoes back the command we sent, so markers appear twice:
            // 1. First occurrence: in the echoed command (e.g., `echo "START_MARKER"`)
            // 2. Second occurrence: actual output from the echo command
            // 
            // We need to find the LAST occurrence of the start marker (the actual output)
            // and the LAST occurrence of the end marker.
            let cleanOutput = "";
            
            // Find the LAST occurrence of start marker followed by newline
            // This is the one produced by the actual `echo` command, not the command echo
            const startMarkerWithNewline = startMarker + "\r\n";
            const lastStartIndex = output.lastIndexOf(startMarkerWithNewline);
            
            // Find the LAST occurrence of end marker (which has the exit code)
            const endMarkerPattern = endMarker + ":";
            const lastEndIndex = output.lastIndexOf(endMarkerPattern);
            
            console.log(`${LOG_PREFIX} Marker positions: startMarker lastIndex=${lastStartIndex}, endMarker lastIndex=${lastEndIndex}`);
            
            if (lastStartIndex !== -1 && lastEndIndex !== -1 && lastEndIndex > lastStartIndex) {
              // Get content after the start marker line, before the end marker
              const contentStart = lastStartIndex + startMarkerWithNewline.length;
              cleanOutput = output.slice(contentStart, lastEndIndex);
              // Trim leading/trailing whitespace (including \r\n)
              cleanOutput = cleanOutput.trim();
              console.log(`${LOG_PREFIX} Successfully extracted content between markers`);
            } else {
              // Fallback: try different patterns
              console.warn(`${LOG_PREFIX} Could not find markers with lastIndexOf, trying regex fallback`);
              
              // Try to find marker at start of a line (after newline)
              const startAfterNewline = output.lastIndexOf("\n" + startMarker);
              const endAfterNewline = output.lastIndexOf("\n" + endMarker);
              
              if (startAfterNewline !== -1 && endAfterNewline !== -1 && endAfterNewline > startAfterNewline) {
                const contentStart = startAfterNewline + 1 + startMarker.length;
                cleanOutput = output.slice(contentStart, endAfterNewline);
                cleanOutput = cleanOutput.trim();
              } else {
                // Last resort: just use first occurrence
                const startIndex = output.indexOf(startMarker);
                const endIndex = output.indexOf(endMarker);
                
                if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
                  cleanOutput = output.slice(startIndex + startMarker.length, endIndex);
                  cleanOutput = cleanOutput.trim();
                }
              }
            }
            
            // Debug: Log extracted output
            console.log(`${LOG_PREFIX} Extracted output (${cleanOutput.length} bytes):`);
            console.log(`${LOG_PREFIX} --- EXTRACTED OUTPUT START ---`);
            console.log(JSON.stringify(cleanOutput));
            console.log(`${LOG_PREFIX} --- EXTRACTED OUTPUT END ---`);
            
            console.log(`${LOG_PREFIX} Command completed: ${cmdStr} (exitCode: ${exitCode}, outputLen: ${cleanOutput.length})`);
            
            resolveOnce({
              success: exitCode === 0,
              stdout: cleanOutput,
              stderr: "", // PTY combines stdout/stderr
              exitCode,
            });
          }
        };

        ws.onclose = (event) => {
          console.log(`${LOG_PREFIX} WebSocket closed for PTY: ${ptyId} (code: ${event.code}, reason: ${event.reason || "none"})`);
          clearTimeout(timeoutId);

          // If we haven't resolved yet (didn't see marker), use heuristics
          if (!resolved) {
            const hasError = this.detectErrorInOutput(output);
            console.log(`${LOG_PREFIX} WebSocket closed before marker seen. Error detected: ${hasError}`);
            
            resolveOnce({
              success: !hasError,
              stdout: output,
              stderr: "", // PTY combines stdout/stderr
              exitCode: hasError ? 1 : 0,
            });
          }
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
   * Escape a string for use in a shell command.
   */
  private shellEscape(arg: string): string {
    // If the argument contains special characters, wrap in single quotes
    // and escape any single quotes within
    if (/[^a-zA-Z0-9_\-./=]/.test(arg)) {
      return "'" + arg.replace(/'/g, "'\"'\"'") + "'";
    }
    return arg;
  }

  /**
   * Build the WebSocket URL for connecting to a PTY session.
   * IMPORTANT: Must include the `directory` query parameter for the server
   * to know which Instance context to use. Without it, the PTY won't be found.
   */
  private buildWebSocketUrl(ptyId: string): string {
    // Convert HTTP URL to WebSocket URL
    const wsProtocol = this.baseUrl.startsWith("https") ? "wss" : "ws";
    const wsBaseUrl = this.baseUrl.replace(/^https?/, wsProtocol);
    // Must include directory parameter - server uses it to scope to the correct Instance
    const encodedDirectory = encodeURIComponent(this.directory);
    return `${wsBaseUrl}/pty/${ptyId}/connect?directory=${encodedDirectory}`;
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
        directory: this.directory,
        path,
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
        directory: this.directory,
        path,
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
        directory: this.directory,
        path,
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
        directory: this.directory,
        path,
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
