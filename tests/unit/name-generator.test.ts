/**
 * Unit tests for name generation utility.
 */

import { describe, test, expect, mock } from "bun:test";
import { generateLoopName, sanitizeLoopName } from "../../src/utils/name-generator";
import type { BackendInterface } from "../../src/utils/name-generator";
import type { AgentResponse } from "../../src/backends/types";

describe("sanitizeLoopName", () => {
  test("converts to lowercase", () => {
    expect(sanitizeLoopName("Add New Feature")).toBe("add-new-feature");
  });

  test("replaces spaces with hyphens", () => {
    expect(sanitizeLoopName("fix login bug")).toBe("fix-login-bug");
  });

  test("replaces underscores with hyphens", () => {
    expect(sanitizeLoopName("update_user_profile")).toBe("update-user-profile");
  });

  test("removes special characters", () => {
    expect(sanitizeLoopName("add-feature!@#$%")).toBe("add-feature");
  });

  test("removes markdown formatting", () => {
    expect(sanitizeLoopName("`add-feature`")).toBe("add-feature");
    expect(sanitizeLoopName("**add-feature**")).toBe("add-feature");
    expect(sanitizeLoopName("_add-feature_")).toBe("add-feature");
  });

  test("collapses multiple hyphens", () => {
    expect(sanitizeLoopName("add---new---feature")).toBe("add-new-feature");
  });

  test("trims leading and trailing hyphens", () => {
    expect(sanitizeLoopName("-add-feature-")).toBe("add-feature");
  });

  test("truncates to 50 characters", () => {
    const longName = "a".repeat(100);
    expect(sanitizeLoopName(longName)).toHaveLength(50);
  });

  test("handles empty string", () => {
    expect(sanitizeLoopName("")).toBe("");
  });

  test("handles complex case", () => {
    expect(sanitizeLoopName("Add **New** Feature_123!")).toBe("add-new-feature-123");
  });
});

describe("generateLoopName", () => {
  test("generates name from prompt successfully", async () => {
    const mockBackend: BackendInterface = {
      sendPrompt: mock(async (_sessionId: string, _prompt) => {
        return {
          id: "test-id",
          content: "add-user-authentication",
          parts: [],
        } as AgentResponse;
      }),
    };

    const name = await generateLoopName({
      prompt: "Add user authentication with email and password",
      backend: mockBackend,
      sessionId: "test-session",
    });

    expect(name).toBe("add-user-authentication");
    expect(mockBackend.sendPrompt).toHaveBeenCalledTimes(1);
  });

  test("sanitizes generated name", async () => {
    const mockBackend: BackendInterface = {
      sendPrompt: mock(async (_sessionId: string, _prompt) => {
        return {
          id: "test-id",
          content: "Add User Authentication!",
          parts: [],
        } as AgentResponse;
      }),
    };

    const name = await generateLoopName({
      prompt: "Add user authentication",
      backend: mockBackend,
      sessionId: "test-session",
    });

    expect(name).toBe("add-user-authentication");
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

    // Should return heuristic-based fallback
    expect(name).toBeTruthy();
    expect(name.length).toBeGreaterThan(0);
    expect(name).toMatch(/^[a-z0-9-]+$/); // Valid kebab-case
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

    // Should return heuristic-based fallback
    expect(name).toBeTruthy();
    expect(name).toMatch(/add-user/); // Should extract key words
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
          content: "!@#$%^&*()", // Only special chars
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
    expect(name).toMatch(/add-user/);
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

    // Should return timestamp-based fallback
    expect(name).toMatch(/^loop-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/);
  });

  test("heuristic fallback extracts key words", async () => {
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

    // Should extract first 5 meaningful words
    expect(name).toBeTruthy();
    expect(name).toContain("add");
    expect(name).toContain("user");
    expect(name).toContain("authentication");
  });
});
