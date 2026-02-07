/**
 * Tests for loopActions API functions.
 *
 * These are pure async functions that call fetch() and return results or throw errors.
 * Each function is tested for success and error responses.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMockApi, MockApiError } from "../helpers/mock-api";
import {
  acceptLoopApi,
  pushLoopApi,
  discardLoopApi,
  deleteLoopApi,
  purgeLoopApi,
  markMergedApi,
  setPendingPromptApi,
  clearPendingPromptApi,
  sendPlanFeedbackApi,
  acceptPlanApi,
  discardPlanApi,
  setPendingApi,
  clearPendingApi,
  addressReviewCommentsApi,
} from "@/hooks/loopActions";

const LOOP_ID = "test-loop-123";

const api = createMockApi();

beforeEach(() => {
  api.reset();
  api.install();
});

afterEach(() => {
  api.uninstall();
});

// ─── acceptLoopApi ───────────────────────────────────────────────────────────

describe("acceptLoopApi", () => {
  test("calls POST /api/loops/:id/accept and returns result", async () => {
    api.post(`/api/loops/${LOOP_ID}/accept`, () => ({
      success: true,
      mergeCommit: "abc123def",
    }));

    const result = await acceptLoopApi(LOOP_ID);

    expect(result).toEqual({ success: true, mergeCommit: "abc123def" });
    expect(api.calls(`/api/loops/${LOOP_ID}/accept`, "POST")).toHaveLength(1);
  });

  test("throws error with message from error response", async () => {
    api.post(`/api/loops/${LOOP_ID}/accept`, () => {
      throw new MockApiError(500, { message: "Merge conflict detected" });
    });

    await expect(acceptLoopApi(LOOP_ID)).rejects.toThrow("Merge conflict detected");
  });

  test("throws fallback error when no message in response", async () => {
    api.post(`/api/loops/${LOOP_ID}/accept`, () => {
      throw new MockApiError(500, {});
    });

    await expect(acceptLoopApi(LOOP_ID)).rejects.toThrow("Failed to accept loop");
  });
});

// ─── pushLoopApi ─────────────────────────────────────────────────────────────

describe("pushLoopApi", () => {
  test("calls POST /api/loops/:id/push and returns result", async () => {
    api.post(`/api/loops/${LOOP_ID}/push`, () => ({
      success: true,
      remoteBranch: "ralph/feature-branch",
    }));

    const result = await pushLoopApi(LOOP_ID);

    expect(result).toEqual({ success: true, remoteBranch: "ralph/feature-branch" });
    expect(api.calls(`/api/loops/${LOOP_ID}/push`, "POST")).toHaveLength(1);
  });

  test("throws error with message from error response", async () => {
    api.post(`/api/loops/${LOOP_ID}/push`, () => {
      throw new MockApiError(500, { message: "Remote rejected push" });
    });

    await expect(pushLoopApi(LOOP_ID)).rejects.toThrow("Remote rejected push");
  });

  test("throws fallback error when no message in response", async () => {
    api.post(`/api/loops/${LOOP_ID}/push`, () => {
      throw new MockApiError(500, {});
    });

    await expect(pushLoopApi(LOOP_ID)).rejects.toThrow("Failed to push loop");
  });
});

// ─── discardLoopApi ──────────────────────────────────────────────────────────

describe("discardLoopApi", () => {
  test("calls POST /api/loops/:id/discard and returns true", async () => {
    api.post(`/api/loops/${LOOP_ID}/discard`, () => ({ success: true }));

    const result = await discardLoopApi(LOOP_ID);

    expect(result).toBe(true);
    expect(api.calls(`/api/loops/${LOOP_ID}/discard`, "POST")).toHaveLength(1);
  });

  test("throws error with message from error response", async () => {
    api.post(`/api/loops/${LOOP_ID}/discard`, () => {
      throw new MockApiError(500, { message: "Cannot discard running loop" });
    });

    await expect(discardLoopApi(LOOP_ID)).rejects.toThrow("Cannot discard running loop");
  });

  test("throws fallback error when no message in response", async () => {
    api.post(`/api/loops/${LOOP_ID}/discard`, () => {
      throw new MockApiError(500, {});
    });

    await expect(discardLoopApi(LOOP_ID)).rejects.toThrow("Failed to discard loop");
  });
});

// ─── deleteLoopApi ───────────────────────────────────────────────────────────

describe("deleteLoopApi", () => {
  test("calls DELETE /api/loops/:id and returns true", async () => {
    api.delete(`/api/loops/${LOOP_ID}`, () => ({ success: true }));

    const result = await deleteLoopApi(LOOP_ID);

    expect(result).toBe(true);
    expect(api.calls(`/api/loops/${LOOP_ID}`, "DELETE")).toHaveLength(1);
  });

  test("throws error with message from error response", async () => {
    api.delete(`/api/loops/${LOOP_ID}`, () => {
      throw new MockApiError(404, { message: "Loop not found" });
    });

    await expect(deleteLoopApi(LOOP_ID)).rejects.toThrow("Loop not found");
  });

  test("throws fallback error when no message in response", async () => {
    api.delete(`/api/loops/${LOOP_ID}`, () => {
      throw new MockApiError(500, {});
    });

    await expect(deleteLoopApi(LOOP_ID)).rejects.toThrow("Failed to delete loop");
  });
});

// ─── purgeLoopApi ────────────────────────────────────────────────────────────

describe("purgeLoopApi", () => {
  test("calls POST /api/loops/:id/purge and returns true", async () => {
    api.post(`/api/loops/${LOOP_ID}/purge`, () => ({ success: true }));

    const result = await purgeLoopApi(LOOP_ID);

    expect(result).toBe(true);
    expect(api.calls(`/api/loops/${LOOP_ID}/purge`, "POST")).toHaveLength(1);
  });

  test("throws error with message from error response", async () => {
    api.post(`/api/loops/${LOOP_ID}/purge`, () => {
      throw new MockApiError(500, { message: "Purge failed: branch in use" });
    });

    await expect(purgeLoopApi(LOOP_ID)).rejects.toThrow("Purge failed: branch in use");
  });

  test("throws fallback error when no message in response", async () => {
    api.post(`/api/loops/${LOOP_ID}/purge`, () => {
      throw new MockApiError(500, {});
    });

    await expect(purgeLoopApi(LOOP_ID)).rejects.toThrow("Failed to purge loop");
  });
});

// ─── markMergedApi ───────────────────────────────────────────────────────────

describe("markMergedApi", () => {
  test("calls POST /api/loops/:id/mark-merged and returns true", async () => {
    api.post(`/api/loops/${LOOP_ID}/mark-merged`, () => ({ success: true }));

    const result = await markMergedApi(LOOP_ID);

    expect(result).toBe(true);
    expect(api.calls(`/api/loops/${LOOP_ID}/mark-merged`, "POST")).toHaveLength(1);
  });

  test("throws error with message from error response", async () => {
    api.post(`/api/loops/${LOOP_ID}/mark-merged`, () => {
      throw new MockApiError(400, { message: "Loop is not in pushed state" });
    });

    await expect(markMergedApi(LOOP_ID)).rejects.toThrow("Loop is not in pushed state");
  });

  test("throws fallback error when no message in response", async () => {
    api.post(`/api/loops/${LOOP_ID}/mark-merged`, () => {
      throw new MockApiError(500, {});
    });

    await expect(markMergedApi(LOOP_ID)).rejects.toThrow("Failed to mark loop as merged");
  });
});

// ─── setPendingPromptApi ─────────────────────────────────────────────────────

describe("setPendingPromptApi", () => {
  test("calls PUT /api/loops/:id/pending-prompt with prompt body and returns true", async () => {
    api.put(`/api/loops/${LOOP_ID}/pending-prompt`, () => ({ success: true }));

    const result = await setPendingPromptApi(LOOP_ID, "Do this next");

    expect(result).toBe(true);
    const calls = api.calls(`/api/loops/${LOOP_ID}/pending-prompt`, "PUT");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ prompt: "Do this next" });
  });

  test("throws error with message from error response", async () => {
    api.put(`/api/loops/${LOOP_ID}/pending-prompt`, () => {
      throw new MockApiError(400, { message: "Prompt cannot be empty" });
    });

    await expect(setPendingPromptApi(LOOP_ID, "")).rejects.toThrow("Prompt cannot be empty");
  });

  test("throws fallback error when no message in response", async () => {
    api.put(`/api/loops/${LOOP_ID}/pending-prompt`, () => {
      throw new MockApiError(500, {});
    });

    await expect(setPendingPromptApi(LOOP_ID, "test")).rejects.toThrow("Failed to set pending prompt");
  });
});

// ─── clearPendingPromptApi ───────────────────────────────────────────────────

describe("clearPendingPromptApi", () => {
  test("calls DELETE /api/loops/:id/pending-prompt and returns true", async () => {
    api.delete(`/api/loops/${LOOP_ID}/pending-prompt`, () => ({ success: true }));

    const result = await clearPendingPromptApi(LOOP_ID);

    expect(result).toBe(true);
    expect(api.calls(`/api/loops/${LOOP_ID}/pending-prompt`, "DELETE")).toHaveLength(1);
  });

  test("throws error with message from error response", async () => {
    api.delete(`/api/loops/${LOOP_ID}/pending-prompt`, () => {
      throw new MockApiError(404, { message: "No pending prompt to clear" });
    });

    await expect(clearPendingPromptApi(LOOP_ID)).rejects.toThrow("No pending prompt to clear");
  });

  test("throws fallback error when no message in response", async () => {
    api.delete(`/api/loops/${LOOP_ID}/pending-prompt`, () => {
      throw new MockApiError(500, {});
    });

    await expect(clearPendingPromptApi(LOOP_ID)).rejects.toThrow("Failed to clear pending prompt");
  });
});

// ─── sendPlanFeedbackApi ─────────────────────────────────────────────────────

describe("sendPlanFeedbackApi", () => {
  test("calls POST /api/loops/:id/plan/feedback with feedback body and returns true", async () => {
    api.post(`/api/loops/${LOOP_ID}/plan/feedback`, () => ({ success: true }));

    const result = await sendPlanFeedbackApi(LOOP_ID, "Add error handling");

    expect(result).toBe(true);
    const calls = api.calls(`/api/loops/${LOOP_ID}/plan/feedback`, "POST");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ feedback: "Add error handling" });
  });

  test("throws error with message from error response", async () => {
    api.post(`/api/loops/${LOOP_ID}/plan/feedback`, () => {
      throw new MockApiError(400, { message: "Loop is not in planning state" });
    });

    await expect(sendPlanFeedbackApi(LOOP_ID, "feedback")).rejects.toThrow("Loop is not in planning state");
  });

  test("throws fallback error when no message in response", async () => {
    api.post(`/api/loops/${LOOP_ID}/plan/feedback`, () => {
      throw new MockApiError(500, {});
    });

    await expect(sendPlanFeedbackApi(LOOP_ID, "feedback")).rejects.toThrow("Failed to send plan feedback");
  });
});

// ─── acceptPlanApi ───────────────────────────────────────────────────────────

describe("acceptPlanApi", () => {
  test("calls POST /api/loops/:id/plan/accept and returns true", async () => {
    api.post(`/api/loops/${LOOP_ID}/plan/accept`, () => ({ success: true }));

    const result = await acceptPlanApi(LOOP_ID);

    expect(result).toBe(true);
    expect(api.calls(`/api/loops/${LOOP_ID}/plan/accept`, "POST")).toHaveLength(1);
  });

  test("throws error with message from error response", async () => {
    api.post(`/api/loops/${LOOP_ID}/plan/accept`, () => {
      throw new MockApiError(400, { message: "Plan is not ready" });
    });

    await expect(acceptPlanApi(LOOP_ID)).rejects.toThrow("Plan is not ready");
  });

  test("throws fallback error when no message in response", async () => {
    api.post(`/api/loops/${LOOP_ID}/plan/accept`, () => {
      throw new MockApiError(500, {});
    });

    await expect(acceptPlanApi(LOOP_ID)).rejects.toThrow("Failed to accept plan");
  });
});

// ─── discardPlanApi ──────────────────────────────────────────────────────────

describe("discardPlanApi", () => {
  test("calls POST /api/loops/:id/plan/discard and returns true", async () => {
    api.post(`/api/loops/${LOOP_ID}/plan/discard`, () => ({ success: true }));

    const result = await discardPlanApi(LOOP_ID);

    expect(result).toBe(true);
    expect(api.calls(`/api/loops/${LOOP_ID}/plan/discard`, "POST")).toHaveLength(1);
  });

  test("throws error with message from error response", async () => {
    api.post(`/api/loops/${LOOP_ID}/plan/discard`, () => {
      throw new MockApiError(400, { message: "No plan to discard" });
    });

    await expect(discardPlanApi(LOOP_ID)).rejects.toThrow("No plan to discard");
  });

  test("throws fallback error when no message in response", async () => {
    api.post(`/api/loops/${LOOP_ID}/plan/discard`, () => {
      throw new MockApiError(500, {});
    });

    await expect(discardPlanApi(LOOP_ID)).rejects.toThrow("Failed to discard plan");
  });
});

// ─── setPendingApi ───────────────────────────────────────────────────────────

describe("setPendingApi", () => {
  test("calls POST /api/loops/:id/pending with message and returns result", async () => {
    api.post(`/api/loops/${LOOP_ID}/pending`, () => ({ success: true }));

    const result = await setPendingApi(LOOP_ID, { message: "Next instruction" });

    expect(result).toEqual({ success: true });
    const calls = api.calls(`/api/loops/${LOOP_ID}/pending`, "POST");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ message: "Next instruction" });
  });

  test("calls POST /api/loops/:id/pending with model and returns result", async () => {
    api.post(`/api/loops/${LOOP_ID}/pending`, () => ({ success: true }));

    const result = await setPendingApi(LOOP_ID, {
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
    });

    expect(result).toEqual({ success: true });
    const calls = api.calls(`/api/loops/${LOOP_ID}/pending`, "POST");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
    });
  });

  test("calls POST /api/loops/:id/pending with both message and model", async () => {
    api.post(`/api/loops/${LOOP_ID}/pending`, () => ({ success: true }));

    const result = await setPendingApi(LOOP_ID, {
      message: "Fix the bug",
      model: { providerID: "openai", modelID: "gpt-4o" },
    });

    expect(result).toEqual({ success: true });
    const calls = api.calls(`/api/loops/${LOOP_ID}/pending`, "POST");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({
      message: "Fix the bug",
      model: { providerID: "openai", modelID: "gpt-4o" },
    });
  });

  test("throws error with message from error response", async () => {
    api.post(`/api/loops/${LOOP_ID}/pending`, () => {
      throw new MockApiError(400, { message: "Loop is not running" });
    });

    await expect(setPendingApi(LOOP_ID, { message: "test" })).rejects.toThrow("Loop is not running");
  });

  test("throws fallback error when no message in response", async () => {
    api.post(`/api/loops/${LOOP_ID}/pending`, () => {
      throw new MockApiError(500, {});
    });

    await expect(setPendingApi(LOOP_ID, { message: "test" })).rejects.toThrow("Failed to set pending values");
  });
});

// ─── clearPendingApi ─────────────────────────────────────────────────────────

describe("clearPendingApi", () => {
  test("calls DELETE /api/loops/:id/pending and returns true", async () => {
    api.delete(`/api/loops/${LOOP_ID}/pending`, () => ({ success: true }));

    const result = await clearPendingApi(LOOP_ID);

    expect(result).toBe(true);
    expect(api.calls(`/api/loops/${LOOP_ID}/pending`, "DELETE")).toHaveLength(1);
  });

  test("throws error with message from error response", async () => {
    api.delete(`/api/loops/${LOOP_ID}/pending`, () => {
      throw new MockApiError(400, { message: "No pending values to clear" });
    });

    await expect(clearPendingApi(LOOP_ID)).rejects.toThrow("No pending values to clear");
  });

  test("throws fallback error when no message in response", async () => {
    api.delete(`/api/loops/${LOOP_ID}/pending`, () => {
      throw new MockApiError(500, {});
    });

    await expect(clearPendingApi(LOOP_ID)).rejects.toThrow("Failed to clear pending values");
  });
});

// ─── addressReviewCommentsApi ────────────────────────────────────────────────

describe("addressReviewCommentsApi", () => {
  test("calls POST /api/loops/:id/address-comments with comments body and returns result", async () => {
    api.post(`/api/loops/${LOOP_ID}/address-comments`, () => ({
      success: true,
      reviewCycle: 2,
      branch: "ralph/loop-123-review-2",
    }));

    const result = await addressReviewCommentsApi(LOOP_ID, "Please fix the typo on line 42");

    expect(result).toEqual({
      success: true,
      reviewCycle: 2,
      branch: "ralph/loop-123-review-2",
    });
    const calls = api.calls(`/api/loops/${LOOP_ID}/address-comments`, "POST");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ comments: "Please fix the typo on line 42" });
  });

  test("throws error using message field from error response", async () => {
    api.post(`/api/loops/${LOOP_ID}/address-comments`, () => {
      throw new MockApiError(400, { message: "Comments cannot be empty" });
    });

    await expect(addressReviewCommentsApi(LOOP_ID, "")).rejects.toThrow("Comments cannot be empty");
  });

  test("throws error using error field when message is absent", async () => {
    // addressReviewCommentsApi checks errorData.message || errorData.error
    api.post(`/api/loops/${LOOP_ID}/address-comments`, () => {
      throw new MockApiError(400, { error: "Loop is not addressable" });
    });

    await expect(addressReviewCommentsApi(LOOP_ID, "comments")).rejects.toThrow("Loop is not addressable");
  });

  test("throws fallback error when neither message nor error in response", async () => {
    api.post(`/api/loops/${LOOP_ID}/address-comments`, () => {
      throw new MockApiError(500, {});
    });

    await expect(addressReviewCommentsApi(LOOP_ID, "comments")).rejects.toThrow("Failed to address comments");
  });
});
