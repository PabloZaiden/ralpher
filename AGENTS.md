# AGENTS.md - AI Coding Agent Guidelines

This document provides guidelines for AI coding agents working on the Ralpher project.

## General Agentic Workflow

When working on tasks, follow this general workflow to ensure clarity and goal alignment:

- Always make sure you have all your goals written down in a document and agreed upon before starting to code.
- Always use the `Todo` functionality to keep track of the work you're doing, and the last `Todo` should always be "verify that all goals are met according to the document, and update the `Todo` again".
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

## Technology Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun (v1.3.5+) |
| Language | TypeScript (strict mode) |
| Frontend | React 19 |
| Styling | Tailwind CSS v4 |
| Module System | ES Modules |


## Build, Lint, and Test Commands

### Development

```bash
# Start development server with hot reload
bun dev

# Alternative: run directly
bun --hot src/index.ts
```

### Production

```bash
# Build for production
bun run build

# Start production server
bun start
```

### Build Options

The build script (`build.ts`) accepts CLI flags:

```bash
bun run build.ts --outdir=dist --minify --sourcemap=linked
bun run build.ts --help  # Show all options
```

### Testing

**No test framework is currently configured.** To add tests, use Bun's built-in test runner:

```bash
# Run all tests
bun test

# Run a single test file
bun test path/to/file.test.ts

# Run tests matching a pattern
bun test --test-name-pattern "pattern"

# Watch mode
bun test --watch
```

Use `.only` to run a specific test:

```typescript
test.only("this specific test", () => {
  // ...
});
```

### Type Checking

```bash
# Run TypeScript type checking
bun x tsc --noEmit
```

## Code Style Guidelines

### Imports

1. **Order imports by category:**
   - Third-party packages first (react, bun, fs)
   - Local modules second
   - Assets last (CSS, SVG)

2. **Use named imports for packages and components:**
   ```typescript
   import { serve } from "bun";
   import { useRef, type FormEvent } from "react";
   import { APITester } from "./APITester";
   ```

3. **Use default imports for assets and plugins:**
   ```typescript
   import plugin from "bun-plugin-tailwind";
   import logo from "./logo.svg";
   ```

4. **Use `type` modifier for type-only imports:**
   ```typescript
   import { useRef, type FormEvent } from "react";
   ```

5. **Path alias available:** `@/*` maps to `./src/*`

### Exports

- Prefer named exports for components
- Optionally add default export for main component files

```typescript
export function MyComponent() { ... }
export default MyComponent;  // Optional
```

### TypeScript

- **Strict mode is enabled** - respect all strict checks
- Use inline type annotations for function parameters
- Use generics for React hooks: `useRef<HTMLElement>(null)`
- Use `as` for type assertions: `formData.get("key") as string`
- Use `Partial<T>` for optional config objects
- Non-null assertions (`!`) are acceptable when the value is guaranteed

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

Define routes in `src/index.ts` using Bun's route-based API:

```typescript
const server = serve({
  routes: {
    "/api/endpoint": {
      async GET(req) {
        return Response.json({ data: "value" });
      },
    },
    "/api/endpoint/:param": async req => {
      return Response.json({ param: req.params.param });
    },
  },
});
```

## Environment Variables

- Public env vars must use `BUN_PUBLIC_*` prefix
- `.env` files are gitignored - never commit secrets

## Bun specifics
This is a Bun-only project. Never check if something might not be supported in another environment. You can assume Bun is always available.

Always use Bun features and APIs where possible.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Always run `bun run build` before running tests, to make sure there are no build errors.
Use `bun run test` to run all the tests.

Always run `bun run test` when you think you are done making changes.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

## General guidelines

- Git operations are allowed. The system manages git branches, commits, and merges for Ralph Loops.
- Always prefer simplicity, usability and top level type safety over cleverness.
- Before doing something, check the patterns used in the rest of the codebase.
