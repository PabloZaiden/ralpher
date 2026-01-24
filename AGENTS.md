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
Use `bun run test` to run all the tests.

Always run `bun run test` when you think you are done making changes.

```typescript
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

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

## General Guidelines

- Git operations are allowed. The system manages git branches, commits, and merges for Ralph Loops.
- Always prefer simplicity, usability and top level type safety over cleverness.
- Before doing something, check the patterns used in the rest of the codebase.
- Keep the `.planning/status.md` file updated with progress.

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
