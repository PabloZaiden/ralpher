/**
 * Unit tests for CommandExecutor — specifically the writeFile method.
 * Uses TestCommandExecutor (local mock) to verify write behavior.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { TestCommandExecutor } from "../mocks/mock-executor";

let testDir: string;
let executor: TestCommandExecutor;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "ralpher-executor-test-"));
  executor = new TestCommandExecutor();
});

afterEach(async () => {
  await rm(testDir, { recursive: true });
});

describe("writeFile", () => {
  test("writes a new file", async () => {
    const filePath = join(testDir, "test.txt");
    const content = "Hello, world!";

    const result = await executor.writeFile(filePath, content);

    expect(result).toBe(true);
    const readBack = await executor.readFile(filePath);
    expect(readBack).toBe(content);
  });

  test("overwrites an existing file", async () => {
    const filePath = join(testDir, "overwrite.txt");

    await executor.writeFile(filePath, "original content");
    const result = await executor.writeFile(filePath, "new content");

    expect(result).toBe(true);
    const readBack = await executor.readFile(filePath);
    expect(readBack).toBe("new content");
  });

  test("creates parent directories if they don't exist", async () => {
    const filePath = join(testDir, "subdir", "nested", "file.txt");
    const content = "nested content";

    const result = await executor.writeFile(filePath, content);

    expect(result).toBe(true);
    const readBack = await executor.readFile(filePath);
    expect(readBack).toBe(content);
  });

  test("handles special characters in content", async () => {
    const filePath = join(testDir, "special.md");
    const content = [
      "# Heading with `backticks`",
      "",
      "Some 'single quotes' and \"double quotes\"",
      "",
      "```typescript",
      "const x = 42;",
      "```",
      "",
      "Dollar signs $HOME and $(command)",
      "Backslashes \\ and newlines\n",
      "Unicode: 日本語テスト 🎉",
    ].join("\n");

    const result = await executor.writeFile(filePath, content);

    expect(result).toBe(true);
    const readBack = await executor.readFile(filePath);
    expect(readBack).toBe(content);
  });

  test("handles empty content", async () => {
    const filePath = join(testDir, "empty.txt");

    const result = await executor.writeFile(filePath, "");

    expect(result).toBe(true);
    const exists = await executor.fileExists(filePath);
    expect(exists).toBe(true);
    const readBack = await executor.readFile(filePath);
    expect(readBack).toBe("");
  });
});
