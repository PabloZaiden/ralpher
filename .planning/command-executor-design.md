# Command Execution Layer Design

## Problem

Ralpher needs to run commands (git, file operations) on the machine where the code lives:
- **Spawn mode**: Code is local to Ralpher, commands run locally via `Bun.$`
- **Connect mode**: Code is on a remote opencode server, commands must run remotely via PTY

Currently, all commands run locally, which breaks connect mode when Ralpher is in Docker.

## Solution

Create a **CommandExecutor** abstraction that:
1. Provides a unified interface for running shell commands
2. Has two implementations: `LocalCommandExecutor` and `RemoteCommandExecutor`
3. Is selected based on the server mode (spawn vs connect)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         LoopManager                             │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────┐    ┌─────────────────┐    ┌──────────────┐   │
│  │ GitService  │───▶│ CommandExecutor │◀───│ FileService  │   │
│  └─────────────┘    └────────┬────────┘    └──────────────┘   │
│                              │                                  │
│            ┌─────────────────┼─────────────────┐               │
│            ▼                                   ▼               │
│  ┌──────────────────┐             ┌────────────────────┐       │
│  │LocalCommandExec  │             │RemoteCommandExec   │       │
│  │   (Bun.$)        │             │(PTY+WebSocket)     │       │
│  └──────────────────┘             └────────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

## Interface

```typescript
interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface CommandExecutor {
  /**
   * Execute a shell command.
   */
  exec(command: string, args: string[], options?: CommandOptions): Promise<CommandResult>;
  
  /**
   * Check if a file exists.
   */
  fileExists(path: string): Promise<boolean>;
  
  /**
   * Check if a directory exists.
   */
  directoryExists(path: string): Promise<boolean>;
  
  /**
   * Read a file's contents.
   */
  readFile(path: string): Promise<string | null>;
  
  /**
   * List files in a directory.
   */
  listDirectory(path: string): Promise<string[]>;
}
```

## Implementation Details

### LocalCommandExecutor

Uses `Bun.$` for command execution and `Bun.file()` for file operations.

```typescript
class LocalCommandExecutor implements CommandExecutor {
  async exec(command: string, args: string[], options?: CommandOptions): Promise<CommandResult> {
    const result = await Bun.$`${command} ${args}`.cwd(options?.cwd ?? ".").quiet();
    return {
      success: result.exitCode === 0,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
      exitCode: result.exitCode,
    };
  }
  
  async fileExists(path: string): Promise<boolean> {
    return Bun.file(path).exists();
  }
  
  // ... etc
}
```

### RemoteCommandExecutor

Uses PTY sessions with WebSocket for full output capture:

```typescript
interface RemoteCommandExecutorConfig {
  client: OpencodeClient;     // SDK client for REST API calls
  directory: string;          // Remote directory
  baseUrl: string;            // e.g., "http://localhost:4096"
  password?: string;          // For Basic auth
}

class RemoteCommandExecutor implements CommandExecutor {
  async exec(command: string, args: string[], options?: CommandOptions): Promise<CommandResult> {
    // 1. For common git queries, use SDK APIs directly (faster)
    // 2. For other commands, use PTY with WebSocket output capture
  }
}
```

## PTY WebSocket Protocol

The opencode server provides a WebSocket endpoint for real-time PTY interaction:

### Connection Flow

1. **Create PTY Session** (REST API)
   ```
   POST /pty
   Body: { command: "git", args: ["status"], cwd: "/path/to/repo" }
   Response: { id: "pty-123", status: "running", ... }
   ```

2. **Connect via WebSocket**
   ```
   ws://hostname:port/pty/{id}/connect?directory=/path/to/repo
   ```

3. **Receive Output**
   - WebSocket `message` events contain terminal output
   - Output includes ANSI escape codes (can be stripped if needed)

4. **Wait for Close**
   - WebSocket `close` event indicates command completed
   - Check PTY status to get exit code

5. **Cleanup**
   ```
   DELETE /pty/{id}
   ```

### Authentication

For password-protected opencode servers, we use Basic auth:
- WebSocket URL: `ws://host:port/pty/{id}/connect?directory=...&auth=BASE64_ENCODED`
- Auth format: `Base64("opencode:" + password)`

### Error Detection

Since PTY combines stdout/stderr and we can't always get the exit code directly,
we use heuristic error detection for common patterns:
- `^fatal:` - Git fatal errors
- `^error:` / `^Error:` - Generic errors
- `command not found`
- `permission denied`

## SDK API Optimizations

For common git operations, we bypass PTY and use SDK APIs directly:

| Git Command | SDK API | Notes |
|-------------|---------|-------|
| `git rev-parse --abbrev-ref HEAD` | `client.vcs.get()` | Get current branch |
| `git rev-parse --is-inside-work-tree` | `client.vcs.get()` | Check if git repo |
| `git status --porcelain` | `client.file.status()` | Get changed files |

This avoids the overhead of PTY creation for frequently-used queries.

## Files

### New Files Created
- `src/core/command-executor.ts` - Interface definition
- `src/core/local-command-executor.ts` - Local implementation
- `src/core/remote-command-executor.ts` - Remote implementation with WebSocket

### Modified Files
- `src/core/git-service.ts` - Uses CommandExecutor
- `src/core/loop-manager.ts` - Gets executor from BackendManager
- `src/core/backend-manager.ts` - Provides mode-appropriate executor
- `src/backends/opencode/index.ts` - Exposes SDK client and directory
- `src/api/git.ts` - Uses mode-appropriate git service for branch listing
- `src/api/loops.ts` - Uses mode-appropriate executor for file operations

## Implementation Status

See [status.md](./status.md) for current implementation status.

## Future Improvements

1. **PTY Pooling**: Reuse PTY sessions for multiple commands
2. **Streaming Output**: Expose real-time output for long-running commands
3. **Exit Code Extraction**: Parse ANSI sequences or use PTY events to get exact exit codes
