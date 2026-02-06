/**
 * Unit tests for name generation utility.
 */

import { describe, test, expect, mock } from "bun:test";
import { generateLoopName, sanitizeLoopName } from "../../src/utils/name-generator";
import type { BackendInterface } from "../../src/utils/name-generator";
import type { AgentResponse } from "../../src/backends/types";

describe("sanitizeLoopName", () => {
  test("preserves natural casing", () => {
    expect(sanitizeLoopName("Add New Feature")).toBe("Add New Feature");
  });

  test("preserves spaces", () => {
    expect(sanitizeLoopName("fix login bug")).toBe("fix login bug");
  });

  test("preserves underscores", () => {
    expect(sanitizeLoopName("update_user_profile")).toBe("update_user_profile");
  });

  test("removes markdown backticks", () => {
    expect(sanitizeLoopName("`add-feature`")).toBe("add-feature");
  });

  test("removes markdown asterisks", () => {
    expect(sanitizeLoopName("**add-feature**")).toBe("add-feature");
  });

  test("removes markdown tildes", () => {
    expect(sanitizeLoopName("~add-feature~")).toBe("add-feature");
  });

  test("removes markdown hash", () => {
    expect(sanitizeLoopName("# Add Feature")).toBe("Add Feature");
  });

  test("trims leading and trailing whitespace", () => {
    expect(sanitizeLoopName("  add feature  ")).toBe("add feature");
  });

  test("truncates to 100 characters", () => {
    const longName = "a".repeat(150);
    expect(sanitizeLoopName(longName)).toHaveLength(100);
  });

  test("handles empty string", () => {
    expect(sanitizeLoopName("")).toBe("");
  });

  test("handles complex case with markdown", () => {
    expect(sanitizeLoopName("Add **New** Feature 123!")).toBe("Add New Feature 123!");
  });

  test("preserves special characters except markdown", () => {
    expect(sanitizeLoopName("Add feature (v2) - urgent!")).toBe("Add feature (v2) - urgent!");
  });
});

describe("generateLoopName", () => {
  test("generates name from prompt successfully", async () => {
    const mockBackend: BackendInterface = {
      sendPrompt: mock(async (_sessionId: string, _prompt) => {
        return {
          id: "test-id",
          content: "Add User Authentication",
          parts: [],
        } as AgentResponse;
      }),
    };

    const name = await generateLoopName({
      prompt: "Add user authentication with email and password",
      backend: mockBackend,
      sessionId: "test-session",
    });

    expect(name).toBe("Add User Authentication");
    expect(mockBackend.sendPrompt).toHaveBeenCalledTimes(1);
  });

  test("sanitizes generated name (removes markdown)", async () => {
    const mockBackend: BackendInterface = {
      sendPrompt: mock(async (_sessionId: string, _prompt) => {
        return {
          id: "test-id",
          content: "**Add User Authentication**",
          parts: [],
        } as AgentResponse;
      }),
    };

    const name = await generateLoopName({
      prompt: "Add user authentication",
      backend: mockBackend,
      sessionId: "test-session",
    });

    expect(name).toBe("Add User Authentication");
  });

  test("truncates prompt to 1000 chars before sending", async () => {
    // Create a prompt with unique markers at different positions
    const part1 = "a".repeat(1000);  // First 1000 chars
    const part2 = "MARKER_AT_1000";  // Unique marker at position 1000
    const part3 = "b".repeat(1000);  // After 1000 chars
    const longPrompt = part1 + part2 + part3;
    let capturedPrompt = "";

    const mockBackend: BackendInterface = {
      sendPrompt: mock(async (_sessionId: string, prompt) => {
        capturedPrompt = prompt.parts[0]?.text ?? "";
        return {
          id: "test-id",
          content: "long-task-name",
          parts: [],
        } as AgentResponse;
      }),
    };

    await generateLoopName({
      prompt: longPrompt,
      backend: mockBackend,
      sessionId: "test-session",
    });

    // The captured prompt should contain the first 1000 chars
    // but NOT the marker at position 1000 (which should be truncated)
    expect(capturedPrompt).toContain(part1);  // First 1000 chars
    expect(capturedPrompt).not.toContain("MARKER_AT_1000");  // Should be cut off
    expect(capturedPrompt).not.toContain(part3.slice(0, 100));  // Should not contain chars after 1000
  });

  test("falls back on backend error", async () => {
    const mockBackend: BackendInterface = {
      sendPrompt: mock(async () => {
        throw new Error("Backend unavailable");
      }),
    };

    const name = await generateLoopName({
      prompt: "Add user authentication",
      backend: mockBackend,
      sessionId: "test-session",
    });

    // Should return heuristic-based fallback with spaces preserved
    expect(name).toBeTruthy();
    expect(name.length).toBeGreaterThan(0);
    expect(name).toContain("Add");
    expect(name).toContain("user");
  });

  test("falls back on timeout", async () => {
    const mockBackend: BackendInterface = {
      sendPrompt: mock(async () => {
        // Simulate slow response
        await new Promise((resolve) => setTimeout(resolve, 15000));
        return {
          id: "test-id",
          content: "slow-response",
          parts: [],
        } as AgentResponse;
      }),
    };

    const name = await generateLoopName({
      prompt: "Add user authentication",
      backend: mockBackend,
      sessionId: "test-session",
      timeoutMs: 100, // Very short timeout
    });

    // Should return fallback due to timeout
    expect(name).toBeTruthy();
    expect(name.length).toBeGreaterThan(0);
  });

  test("falls back on empty response", async () => {
    const mockBackend: BackendInterface = {
      sendPrompt: mock(async () => {
        return {
          id: "test-id",
          content: "",
          parts: [],
        } as AgentResponse;
      }),
    };

    const name = await generateLoopName({
      prompt: "Add user authentication",
      backend: mockBackend,
      sessionId: "test-session",
    });

    // Should return heuristic-based fallback with original casing
    expect(name).toBeTruthy();
    expect(name).toContain("Add");
    expect(name).toContain("user");
  });

  test("falls back on very long response", async () => {
    const mockBackend: BackendInterface = {
      sendPrompt: mock(async () => {
        return {
          id: "test-id",
          content: "a".repeat(200), // Too long
          parts: [],
        } as AgentResponse;
      }),
    };

    const name = await generateLoopName({
      prompt: "Add user authentication",
      backend: mockBackend,
      sessionId: "test-session",
    });

    // Should return heuristic-based fallback
    expect(name).toBeTruthy();
    expect(name.length).toBeGreaterThan(0);
  });

  test("falls back when sanitization produces empty string", async () => {
    const mockBackend: BackendInterface = {
      sendPrompt: mock(async () => {
        return {
          id: "test-id",
          content: "`*~#", // Only markdown chars that get removed
          parts: [],
        } as AgentResponse;
      }),
    };

    const name = await generateLoopName({
      prompt: "Add user authentication",
      backend: mockBackend,
      sessionId: "test-session",
    });

    // Should return heuristic-based fallback
    expect(name).toBeTruthy();
    expect(name).toContain("Add");
    expect(name).toContain("user");
  });

  test("throws error on empty prompt", async () => {
    const mockBackend: BackendInterface = {
      sendPrompt: mock(async () => {
        return {
          id: "test-id",
          content: "test",
          parts: [],
        } as AgentResponse;
      }),
    };

    await expect(
      generateLoopName({
        prompt: "",
        backend: mockBackend,
        sessionId: "test-session",
      })
    ).rejects.toThrow("Prompt cannot be empty");
  });

  test("throws error on whitespace-only prompt", async () => {
    const mockBackend: BackendInterface = {
      sendPrompt: mock(async () => {
        return {
          id: "test-id",
          content: "test",
          parts: [],
        } as AgentResponse;
      }),
    };

    await expect(
      generateLoopName({
        prompt: "   ",
        backend: mockBackend,
        sessionId: "test-session",
      })
    ).rejects.toThrow("Prompt cannot be empty");
  });

  test("generates timestamp-based fallback for very short prompt", async () => {
    const mockBackend: BackendInterface = {
      sendPrompt: mock(async () => {
        throw new Error("Backend error");
      }),
    };

    const name = await generateLoopName({
      prompt: "a b",  // Very short, words too small
      backend: mockBackend,
      sessionId: "test-session",
    });

    // Should return timestamp-based fallback with spaces
    expect(name).toMatch(/^Loop \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test("heuristic fallback extracts key words with original casing", async () => {
    const mockBackend: BackendInterface = {
      sendPrompt: mock(async () => {
        throw new Error("Backend error");
      }),
    };

    const name = await generateLoopName({
      prompt: "Add user authentication with OAuth and JWT tokens for secure login",
      backend: mockBackend,
      sessionId: "test-session",
    });

    // Should extract meaningful words preserving casing
    expect(name).toBeTruthy();
    expect(name).toContain("Add");
    expect(name).toContain("user");
    expect(name).toContain("authentication");
  });
});
