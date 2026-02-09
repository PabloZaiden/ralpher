# AGENTS.md - AI Coding Agent Guidelines

This document provides guidelines for AI coding agents working on the Ralpher project.

## General Agentic Workflow

When working on tasks, follow this general workflow to ensure clarity and goal alignment:

- Always make sure you have all your goals written down in a document in `./.planning/plan.md` and agreed upon before starting to code.
- Always use the `Todo` functionality to keep track of the work you're doing, and the last `Todo` should always be "verify that all goals are met according to the document, and update the `Todo` again". Use `./.planning/status.md` to track the plan status.
- Track the status of the work in that document.
- After checking the document, update what the next steps to work on are, and what's important to know about it to be able to continue working on it later.
- Make sure that the goals you are trying to achieve are written down, in a way that you can properly verify them later.
- Don't say something is done until you have verified that all the goals are met.
- The general loop then is:

  1. Write down the goals you want to achieve.
  2. Write the code to achieve those goals.
  3. Verify that all the goals are met.
  4. Update the document with the status of the work.
  5. If all goals are met, you are done.
  6. If not, go back to step 2.

## Project Overview

Ralpher is a full-stack Bun + React application for controlling and managing Ralph Loops in opencode. It uses Bun's native bundler and server, React 19 for the frontend, and Tailwind CSS v4 for styling.

For more project information, see the [README.md](README.md).

## Authentication & Authorization

Ralpher runs behind a reverse proxy that enforces authentication and authorization. The application itself does not implement authentication or authorization — all access control is handled at the infrastructure level before requests reach Ralpher. This means:

- API endpoints do not require authentication tokens or session validation
- Destructive endpoints (server kill, database reset) are protected by the reverse proxy
- WebSocket connections are authenticated at the proxy level

## Remote Command Execution Architecture

**CRITICAL: All operations on workspace repositories MUST be executed on the remote opencode server, NEVER locally on the Ralpher server.**

Ralpher connects to opencode servers that may be running in different environments (e.g., devcontainers, remote machines). The workspace directory paths (like `/workspaces/myrepo`) exist on the **remote** server, not on the machine running Ralpher.

### How to Execute Commands on Remote Servers

Always use the `CommandExecutor` interface to run commands on the remote server:

```typescript
// Get a command executor for a workspace
const executor = await backendManager.getCommandExecutorAsync(workspaceId, directory);

// Execute git commands - always use -C flag to specify directory explicitly
const result = await executor.exec("git", ["-C", directory, "status"]);

// Use GitService for git operations (preferred - provides better encapsulation)
const git = GitService.withExecutor(executor);
const isRepo = await git.isGitRepo(directory);
const branch = await git.getCurrentBranch(directory);
```

### What NOT to Do

```typescript
// WRONG - runs locally, will fail for remote workspaces
import { existsSync } from "fs";
if (existsSync(directory)) { ... }

// WRONG - runs locally, directory may not exist on Ralpher server
await Bun.$`git -C ${directory} status`;

// WRONG - checks local filesystem
const file = Bun.file(path);
if (await file.exists()) { ... }
```

### What to Do Instead

```typescript
// CORRECT - runs on remote server via CommandExecutor
const executor = await backendManager.getCommandExecutorAsync(workspaceId, directory);
const exists = await executor.directoryExists(directory);
const result = await executor.exec("git", ["-C", directory, "status"]);
const content = await executor.readFile(path);
```

### Available CommandExecutor Methods

- `exec(command, args, options?)` - Execute a shell command
- `fileExists(path)` - Check if a file exists
- `directoryExists(path)` - Check if a directory exists
- `readFile(path)` - Read a file's contents
- `writeFile(path, content)` - Write content to a file (uses base64 encoding for safe transfer)
- `listDirectory(path)` - List files in a directory

### TypeScript

- **Strict mode is enabled** - respect all strict checks
- Use inline type annotations for function parameters
- Use generics for React hooks: `useRef<HTMLElement>(null)`
- Use `as` for type assertions: `formData.get("key") as string`
- Use `Partial<T>` for optional config objects
- Non-null assertions (`!`) are acceptable when the value is guaranteed
- **Use bracket notation for index signatures**: `process.env["VAR"]` not `process.env.VAR`

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| React Components | PascalCase.tsx | `App.tsx`, `APITester.tsx` |
| TypeScript files | lowercase.ts | `index.ts`, `build.ts` |
| Functions | camelCase | `testEndpoint`, `parseArgs` |
| Variables | camelCase | `responseInputRef`, `formData` |
| Type declarations | kebab-case.d.ts | `bun-env.d.ts` |

### Error Handling

Use try/catch with String conversion for error display:

```typescript
try {
  const data = await res.json();
  // handle success
} catch (error) {
  console.error(String(error));
}
```

### Async Patterns

Use async/await consistently:

```typescript
async GET(req) {
  return Response.json({ message: "Hello" });
}

const handler = async (e: FormEvent) => {
  const res = await fetch(url);
};
```

**CRITICAL: Always await async operations in API handlers.** Never use fire-and-forget patterns like `.then()` or `.catch()` without `await` in API route handlers. The API response should only be sent after all operations complete:

```typescript
// WRONG - fire and forget, errors are silently swallowed
async POST(req) {
  engine.start().catch((error) => log.error(error));
  return Response.json({ success: true }); // Returns before start() completes!
}

// CORRECT - await all async operations
async POST(req) {
  try {
    await engine.start();
    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ success: false, error: String(error) }, { status: 500 });
  }
}
```

**Exception for long-running processes:** Fire-and-forget is acceptable when starting a long-running process that:
1. Runs for an extended duration (minutes to hours) where blocking the HTTP response is impractical
2. Has comprehensive self-contained error handling (try/catch, state updates to "failed", error event emission)
3. Reports progress and errors through alternative channels (event emitters, persistence callbacks, WebSocket events)
4. Documents the pattern explicitly with inline comments explaining the design decision

Example: `engine.start()` in `LoopManager.startLoop()` uses fire-and-forget because the loop engine runs a `while`-loop with multiple AI iterations that may take hours. The engine has its own `handleError()` method that updates loop state to "failed" and emits error events. Awaiting would block the API response indefinitely.

### React Components

- Use functional components only (no class components)
- Define components as function declarations, not arrow functions
- Use Tailwind CSS utility classes inline

```typescript
export function MyComponent() {
  return (
    <div className="max-w-7xl mx-auto p-8">
      {/* content */}
    </div>
  );
}
```

### Comments

- Use JSDoc blocks for file-level documentation
- Use inline comments for context and explanations
- Generated files should include origin comment

```typescript
/**
 * This file handles the main application logic.
 */

// Serve index.html for all unmatched routes.
"/*": index,
```

### Formatting

- 2-space indentation
- Double quotes for imports
- Template literals for string interpolation
- Trailing commas in multiline structures

## API Routes

Define routes in `src/api/` modules using Bun's route-based API:

```typescript
export const myRoutes = {
  "/api/endpoint": {
    async GET(req) {
      return Response.json({ data: "value" });
    },
    async POST(req) {
      const body = await req.json();
      return Response.json({ received: body }, { status: 201 });
    },
  },
  "/api/endpoint/:param": async (req: Request & { params: { param: string } }) => {
    return Response.json({ param: req.params.param });
  },
};
```

Routes are aggregated in `src/api/index.ts` and spread into the server.

## Bun Specifics

This is a Bun-only project. Never check if something might not be supported in another environment. You can assume Bun is always available.

Always use Bun features and APIs where possible:

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

## APIs

- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Use `Bun.$` for shell commands instead of execa

```typescript
// File operations
const file = Bun.file("path/to/file");
const content = await file.text();
await Bun.write("path/to/file", content);

// Shell commands
const result = await Bun.$`git status`.text();
```

## Testing

Always run `bun run build` before running tests, to make sure there are no build errors.
Use `bun run test` to run all the tests. Don't do `bun test` directly, since the script cleans a lot of the logs that add noise to the tests.

Always run `bun run test` when you think you are done making changes.

```typescript
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

### Testing Guidelines

- Every new feature that is not exclusively a UI change **MUST** have unit tests covering its functionality
- Every new feature **SHOULD** have a scenario test (integration test) covering the complete user workflow
- Every bug fix **MUST** have a test case that reproduces the bug
- Every bug fix **SHOULD** have a scenario test covering the fix in a real-world context
- Unit tests should be written alongside implementation, not after
- Scenario tests should cover multiple combinations and edge cases
- UI-only changes may rely on manual testing, but automated tests are preferred when possible
- **100%** of the tests **MUST** pass before considering a feature complete
- A flaky test that fails intermittently **MUST** be fixed. A lot of times, flaky tests indicate deeper issues, race conditions, or bad mock implementations.
- **Tests MUST be deterministic**: Tests should never have conditional expectations based on timing or race conditions. If a test sometimes expects one outcome and sometimes another, the test is flaky and must be fixed. Use polling helpers, explicit waits, or control execution flow to ensure deterministic behavior.

### Test Patterns

1. **Unit tests** (`tests/unit/`): Test individual functions and classes
2. **API tests** (`tests/api/`): Test HTTP endpoints with real requests
3. **E2E tests** (`tests/e2e/`): Test full workflows

Use the test utilities from `tests/setup.ts`:

```typescript
import { setupTestContext, teardownTestContext } from "../setup";

let context: Awaited<ReturnType<typeof setupTestContext>>;

beforeEach(async () => {
  context = await setupTestContext({ initGit: true });
});

afterEach(async () => {
  await teardownTestContext(context);
});
```

### Git Branch Names in Tests

**IMPORTANT:** Never hardcode `main` or `master` as branch names in tests. The default branch name varies between environments (local machines may use `main`, CI may use `master`).

Always get the current branch name dynamically:

```typescript
// WRONG - will fail on systems with different default branch
await Bun.$`git -C ${workDir} push origin main`.quiet();

// CORRECT - works on all systems
const currentBranch = (await Bun.$`git -C ${workDir} branch --show-current`.text()).trim();
await Bun.$`git -C ${workDir} push origin ${currentBranch}`.quiet();
```

### Avoiding Flaky Tests with Polling

**CRITICAL:** Never use fixed delays (`delay()`, `setTimeout`) to wait for async operations in tests. Fixed delays are inherently flaky because execution time varies across environments.

Instead, use polling helpers that wait for a specific condition to be met:

```typescript
// WRONG - flaky, timing-dependent
await delay(500);
const loop = await manager.getLoop(loopId);
expect(loop.state.status).toBe("completed");

// CORRECT - polls until condition is met
const loop = await waitForLoopStatus(manager, loopId, ["completed"]);
expect(loop.state.status).toBe("completed");
```

**Available polling helpers in `tests/setup.ts`:**

- `waitForLoopStatus(manager, loopId, expectedStatuses[], timeoutMs?)` - Wait for loop to reach status
- `waitForPlanReady(manager, loopId, timeoutMs?)` - Wait for plan's `isPlanReady` to be true
- `waitForFileDeleted(filePath, timeoutMs?)` - Wait for file to be deleted
- `waitForFileExists(filePath, timeoutMs?)` - Wait for file to appear
- `waitForEvent(events, eventType, timeoutMs?)` - Wait for specific event to be emitted

**For HTTP API tests**, use helpers from `tests/integration/user-scenarios/helpers.ts`:

- `waitForLoopStatus(baseUrl, loopId, expectedStatus, timeoutMs?)` - HTTP-based status polling
- `waitForPlanReady(baseUrl, loopId, timeoutMs?)` - HTTP-based plan ready polling

**Guidelines:**

1. Polling helpers should have reasonable timeouts (10s default) with informative error messages
2. Poll interval should be short (50ms) to minimize test duration
3. Error messages should include the last observed state for debugging
4. If you need to wait for a condition, create a new polling helper rather than using `delay()`

## General Guidelines

- Git operations are allowed. The system manages git branches, commits, and merges for Ralph Loops.
- Always prefer simplicity, usability and top level type safety over cleverness.
- Before doing something, check the patterns used in the rest of the codebase.
- Keep the `.planning/status.md` file updated with progress.
- **Never use time estimates** in plans, documentation, or task descriptions. Time estimates are inherently inaccurate and create false expectations. Use complexity levels (Low, Medium, High) instead.
- **Avoid code duplication**: When you find yourself writing similar code in multiple places, refactor to extract the common logic into a shared function or method. Use parameters to handle variations rather than duplicating code. This improves maintainability and reduces the risk of inconsistent behavior.

## Common Patterns

### Adding a New API Endpoint

1. Add the route handler in the appropriate `src/api/*.ts` file
2. Export from `src/api/index.ts`
3. Add types in `src/types/api.ts` if needed
4. Add tests in `tests/api/`

### Fixing TypeScript Errors

Common fixes:

1. **Unused imports**: Remove or use them
2. **Unused parameters**: Prefix with `_` (e.g., `_unused`)
3. **Index signature access**: Use `obj["prop"]` instead of `obj.prop` for `Record<string, unknown>` and `process.env`
4. **Type-only imports**: Use `import type { X }` for types not used as values

## Database Migrations

The project uses a migration system to evolve the database schema over time while maintaining backward compatibility with existing databases.

### How Migrations Work

1. Migrations are defined in `src/persistence/migrations/index.ts`
2. Each migration has a `version` (sequential integer), `name`, and `up` function
3. The `schema_migrations` table tracks which migrations have been applied
4. Migrations run automatically during database initialization
5. Migrations are idempotent - they check if changes already exist before applying

### Adding a New Migration

When you need to add a new column, table, or modify the schema:

1. **Add the migration** to the `migrations` array in `src/persistence/migrations/index.ts`:

```typescript
{
  version: 2, // Next sequential number
  name: "add_new_column",
  up: (db) => {
    // Check if column already exists (for idempotency)
    const columns = getTableColumns(db, "loops");
    if (columns.includes("new_column")) {
      return;
    }
    db.run("ALTER TABLE loops ADD COLUMN new_column TEXT");
  },
}
```

2. **Do NOT modify the base schema** in `src/persistence/database.ts`. New columns/tables should only be added via migrations to ensure existing databases are properly upgraded.

3. **Add a test** in `tests/unit/migrations.test.ts` to verify:
   - The migration applies correctly to old databases (without the new column)
   - The migration is idempotent (doesn't fail if run twice)
   - The migration handles fresh databases (where column might already exist)

### Migration Guidelines

- **Never modify existing migrations** - only add new ones
- **Always check if changes already exist** before applying (idempotent)
- **Use sequential version numbers** - check the last migration's version
- **Use descriptive snake_case names** - e.g., `add_user_preferences`
- **Test with both old and new databases**

### Resetting the Database

If the database gets corrupted or you need a fresh start:

1. **Via UI**: Server Settings modal -> "Reset all settings" button
2. **Via API**: `POST /api/settings/reset-all`
3. **Manual**: Delete `data/ralpher.db` and related WAL files, then restart

This will delete all loops, sessions, and preferences. Use with caution.
