/**
 * Tests for the PlanReviewPanel component.
 *
 * PlanReviewPanel displays plan content, provides feedback input,
 * and handles accept/discard plan actions.
 */

import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import { PlanReviewPanel } from "@/components/PlanReviewPanel";
import { renderWithUser, waitFor } from "../helpers/render";
import { createLoopWithStatus } from "../helpers/factories";
import { createMockApi } from "../helpers/mock-api";

// Mock API for the markdown preference hook
const api = createMockApi();

beforeEach(() => {
  api.reset();
  api.install();
  // Mock the markdown rendering preference endpoint (used by useMarkdownPreference)
  api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
});

afterEach(() => {
  api.uninstall();
});

// Default props
function defaultProps(overrides?: Partial<Parameters<typeof PlanReviewPanel>[0]>) {
  const loop = createLoopWithStatus("planning");
  return {
    loop,
    planContent: "# Test Plan\n\n1. Do something\n2. Do something else",
    isPlanReady: true,
    onSendFeedback: mock(async (_feedback: string) => {}),
    onAcceptPlan: mock(async () => {}),
    onDiscardPlan: mock(async () => {}),
    ...overrides,
  };
}

describe("PlanReviewPanel", () => {
  describe("tab navigation", () => {
    test("renders Plan and Activity Log tabs", () => {
      const { getByText } = renderWithUser(
        <PlanReviewPanel {...defaultProps()} />
      );
      expect(getByText("Plan")).toBeInTheDocument();
      expect(getByText("Activity Log")).toBeInTheDocument();
    });

    test("Plan tab is active by default", () => {
      const { getByText } = renderWithUser(
        <PlanReviewPanel {...defaultProps()} />
      );
      const planTab = getByText("Plan");
      // Active tab has blue border class
      expect(planTab.closest("button")?.className).toContain("border-blue-500");
    });

    test("clicking Activity Log tab switches content", async () => {
      const { getByText, user } = renderWithUser(
        <PlanReviewPanel {...defaultProps()} />
      );
      // Click Activity Log tab
      await user.click(getByText("Activity Log"));
      // Activity Log tab should now be active
      const logTab = getByText("Activity Log");
      expect(logTab.closest("button")?.className).toContain("border-blue-500");
    });
  });

  describe("plan content display", () => {
    test("renders plan content when available and ready", () => {
      const { getByText } = renderWithUser(
        <PlanReviewPanel {...defaultProps({ planContent: "My plan text", isPlanReady: true })} />
      );
      expect(getByText("My plan text")).toBeInTheDocument();
    });

    test("shows 'AI is still writing...' indicator when plan is not ready", () => {
      const { getByText } = renderWithUser(
        <PlanReviewPanel {...defaultProps({ planContent: "Partial plan", isPlanReady: false })} />
      );
      expect(getByText("AI is still writing...")).toBeInTheDocument();
      expect(getByText("Partial plan")).toBeInTheDocument();
    });

    test("shows waiting message when no plan content", () => {
      const { getByText } = renderWithUser(
        <PlanReviewPanel {...defaultProps({ planContent: "", isPlanReady: false })} />
      );
      expect(getByText("Waiting for AI to generate plan...")).toBeInTheDocument();
    });
  });

  describe("feedback section", () => {
    test("renders feedback textarea", () => {
      const { getByPlaceholderText } = renderWithUser(
        <PlanReviewPanel {...defaultProps()} />
      );
      expect(getByPlaceholderText(/Enter your feedback/)).toBeInTheDocument();
    });

    test("renders Send Feedback button", () => {
      const { getByRole } = renderWithUser(
        <PlanReviewPanel {...defaultProps()} />
      );
      expect(getByRole("button", { name: "Send Feedback" })).toBeInTheDocument();
    });

    test("Send Feedback is disabled when textarea is empty", () => {
      const { getByRole } = renderWithUser(
        <PlanReviewPanel {...defaultProps()} />
      );
      expect(getByRole("button", { name: "Send Feedback" })).toBeDisabled();
    });

    test("Send Feedback is enabled when feedback is entered", async () => {
      const { getByRole, getByPlaceholderText, user } = renderWithUser(
        <PlanReviewPanel {...defaultProps()} />
      );
      await user.type(getByPlaceholderText(/Enter your feedback/), "Looks good");
      expect(getByRole("button", { name: "Send Feedback" })).not.toBeDisabled();
    });

    test("calls onSendFeedback with text and clears textarea", async () => {
      const onSendFeedback = mock(async (_feedback: string) => {});
      const { getByRole, getByPlaceholderText, user } = renderWithUser(
        <PlanReviewPanel {...defaultProps({ onSendFeedback })} />
      );

      const textarea = getByPlaceholderText(/Enter your feedback/);
      await user.type(textarea, "Add more tests");
      await user.click(getByRole("button", { name: "Send Feedback" }));

      await waitFor(() => {
        expect(onSendFeedback).toHaveBeenCalledTimes(1);
        expect(onSendFeedback).toHaveBeenCalledWith("Add more tests");
      });

      // Textarea should be cleared after successful send
      await waitFor(() => {
        expect((textarea as HTMLTextAreaElement).value).toBe("");
      });
    });

    test("does not call onSendFeedback with empty/whitespace feedback", async () => {
      const onSendFeedback = mock(async (_feedback: string) => {});
      const { getByRole, getByPlaceholderText, user } = renderWithUser(
        <PlanReviewPanel {...defaultProps({ onSendFeedback })} />
      );

      // Type only spaces
      await user.type(getByPlaceholderText(/Enter your feedback/), "   ");
      // Button should still be disabled (feedback.trim() is empty)
      expect(getByRole("button", { name: "Send Feedback" })).toBeDisabled();
    });
  });

  describe("feedback rounds", () => {
    test("shows feedback rounds count when > 0", () => {
      const loop = createLoopWithStatus("planning", {
        state: {
          planMode: {
            active: true,
            feedbackRounds: 3,
            planningFolderCleared: false,
            isPlanReady: true,
          },
        },
      });

      const { getByText } = renderWithUser(
        <PlanReviewPanel {...defaultProps({ loop })} />
      );
      expect(getByText("Feedback rounds: 3")).toBeInTheDocument();
    });

    test("does not show feedback rounds when 0", () => {
      const loop = createLoopWithStatus("planning", {
        state: {
          planMode: {
            active: true,
            feedbackRounds: 0,
            planningFolderCleared: false,
            isPlanReady: false,
          },
        },
      });

      const { queryByText } = renderWithUser(
        <PlanReviewPanel {...defaultProps({ loop })} />
      );
      expect(queryByText(/Feedback rounds/)).not.toBeInTheDocument();
    });
  });

  describe("plan actions", () => {
    test("renders Accept Plan & Start Loop button", () => {
      const { getByRole } = renderWithUser(
        <PlanReviewPanel {...defaultProps()} />
      );
      expect(getByRole("button", { name: "Accept Plan & Start Loop" })).toBeInTheDocument();
    });

    test("renders Discard Plan button", () => {
      const { getByRole } = renderWithUser(
        <PlanReviewPanel {...defaultProps()} />
      );
      expect(getByRole("button", { name: "Discard Plan" })).toBeInTheDocument();
    });

    test("Accept Plan is disabled when plan is not ready", () => {
      const { getByRole } = renderWithUser(
        <PlanReviewPanel {...defaultProps({ isPlanReady: false })} />
      );
      expect(getByRole("button", { name: "Accept Plan & Start Loop" })).toBeDisabled();
    });

    test("Accept Plan is disabled when plan content is empty", () => {
      const { getByRole } = renderWithUser(
        <PlanReviewPanel {...defaultProps({ planContent: "" })} />
      );
      expect(getByRole("button", { name: "Accept Plan & Start Loop" })).toBeDisabled();
    });

    test("Accept Plan is enabled when plan is ready with content", () => {
      const { getByRole } = renderWithUser(
        <PlanReviewPanel {...defaultProps({ isPlanReady: true, planContent: "My plan" })} />
      );
      expect(getByRole("button", { name: "Accept Plan & Start Loop" })).not.toBeDisabled();
    });

    test("calls onAcceptPlan when Accept button is clicked", async () => {
      const onAcceptPlan = mock(async () => {});
      const { getByRole, user } = renderWithUser(
        <PlanReviewPanel {...defaultProps({ onAcceptPlan })} />
      );

      await user.click(getByRole("button", { name: "Accept Plan & Start Loop" }));

      await waitFor(() => {
        expect(onAcceptPlan).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("discard confirmation", () => {
    test("shows discard confirmation dialog when Discard Plan clicked", async () => {
      const { getByRole, getByText, user } = renderWithUser(
        <PlanReviewPanel {...defaultProps()} />
      );

      await user.click(getByRole("button", { name: "Discard Plan" }));

      // Confirmation dialog should appear
      expect(getByText("Discard Plan?")).toBeInTheDocument();
      expect(getByText(/Are you sure you want to discard this plan/)).toBeInTheDocument();
    });

    test("calls onDiscardPlan when confirmed", async () => {
      const onDiscardPlan = mock(async () => {});
      const { getByRole, user } = renderWithUser(
        <PlanReviewPanel {...defaultProps({ onDiscardPlan })} />
      );

      // Open confirmation
      await user.click(getByRole("button", { name: "Discard Plan" }));
      // Confirm discard
      await user.click(getByRole("button", { name: "Discard" }));

      await waitFor(() => {
        expect(onDiscardPlan).toHaveBeenCalledTimes(1);
      });
    });

    test("closes confirmation dialog on Cancel", async () => {
      const { getByRole, queryByText, user } = renderWithUser(
        <PlanReviewPanel {...defaultProps()} />
      );

      // Open confirmation
      await user.click(getByRole("button", { name: "Discard Plan" }));
      expect(queryByText("Discard Plan?")).toBeInTheDocument();

      // Cancel
      await user.click(getByRole("button", { name: "Cancel" }));
      expect(queryByText("Discard Plan?")).not.toBeInTheDocument();
    });
  });

  describe("original prompt display", () => {
    test("renders collapsible Original Prompt section", () => {
      const { getByRole } = renderWithUser(
        <PlanReviewPanel {...defaultProps()} />
      );
      expect(getByRole("button", { name: "Original Prompt" })).toBeInTheDocument();
    });

    test("prompt section is collapsed by default", () => {
      const props = defaultProps();
      const { queryByText } = renderWithUser(
        <PlanReviewPanel {...props} />
      );
      // The prompt text should not be visible when collapsed
      expect(queryByText(props.loop.config.prompt)).not.toBeInTheDocument();
    });

    test("expands to show prompt content when clicked", async () => {
      const props = defaultProps();
      const { getByRole, getByText, user } = renderWithUser(
        <PlanReviewPanel {...props} />
      );

      // Click the "Original Prompt" button to expand
      await user.click(getByRole("button", { name: "Original Prompt" }));

      // Now the prompt text should be visible
      expect(getByText(props.loop.config.prompt)).toBeInTheDocument();
    });

    test("collapses again when clicked a second time", async () => {
      const props = defaultProps();
      const { getByRole, getByText, queryByText, user } = renderWithUser(
        <PlanReviewPanel {...props} />
      );

      const button = getByRole("button", { name: "Original Prompt" });

      // Expand
      await user.click(button);
      expect(getByText(props.loop.config.prompt)).toBeInTheDocument();

      // Collapse
      await user.click(button);
      expect(queryByText(props.loop.config.prompt)).not.toBeInTheDocument();
    });

    test("displays custom prompt from loop config", async () => {
      const loop = createLoopWithStatus("planning", {
        config: { prompt: "Build a REST API with authentication" },
      });
      const { getByRole, getByText, user } = renderWithUser(
        <PlanReviewPanel {...defaultProps({ loop })} />
      );

      await user.click(getByRole("button", { name: "Original Prompt" }));
      expect(getByText("Build a REST API with authentication")).toBeInTheDocument();
    });

    test("shows fallback text when prompt is empty", async () => {
      const loop = createLoopWithStatus("planning", {
        config: { prompt: "" },
      });
      const { getByRole, getByText, user } = renderWithUser(
        <PlanReviewPanel {...defaultProps({ loop })} />
      );

      await user.click(getByRole("button", { name: "Original Prompt" }));
      expect(getByText("No prompt specified.")).toBeInTheDocument();
    });

    test("has correct aria-expanded attribute", async () => {
      const { getByRole, user } = renderWithUser(
        <PlanReviewPanel {...defaultProps()} />
      );

      const button = getByRole("button", { name: "Original Prompt" });
      expect(button).toHaveAttribute("aria-expanded", "false");

      await user.click(button);
      expect(button).toHaveAttribute("aria-expanded", "true");
    });
  });

  describe("activity log tab", () => {
    test("shows activity indicator dot when log has activity", () => {
      const { container } = renderWithUser(
        <PlanReviewPanel
          {...defaultProps({
            messages: [{ id: "1", role: "user", content: "test", timestamp: new Date().toISOString() }],
          })}
        />
      );
      // Activity indicator is a pinging cyan dot (animate-ping class)
      const dots = container.querySelectorAll(".animate-ping");
      expect(dots.length).toBeGreaterThan(0);
    });

    test("shows LogViewer when Activity Log tab is selected", async () => {
      const { getByText, user } = renderWithUser(
        <PlanReviewPanel
          {...defaultProps({
            messages: [],
            toolCalls: [],
            logs: [],
          })}
        />
      );

      await user.click(getByText("Activity Log"));
      // LogViewer shows "Working..." because PlanReviewPanel passes isActive (always true during planning)
      expect(getByText("Working...")).toBeInTheDocument();
    });
  });
});
