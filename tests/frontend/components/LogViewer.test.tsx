/**
 * Tests for the LogViewer component.
 *
 * LogViewer displays messages, tool calls, and application logs
 * in chronological order with auto-scroll behavior.
 */

import { test, expect, describe } from "bun:test";
import { LogViewer } from "@/components/LogViewer";
import type { LogEntry } from "@/components/LogViewer";
import { renderWithUser, waitFor } from "../helpers/render";
import {
  createMessageData,
  createToolCallData,
} from "../helpers/factories";
import type { MessageData, ToolCallData } from "@/types";

// Helper to create a log entry
function createLogEntry(overrides?: Partial<LogEntry>): LogEntry {
  return {
    id: `log-${Date.now()}-${Math.random()}`,
    level: "info",
    message: "Test log message",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("LogViewer", () => {
  describe("empty state", () => {
    test("renders empty state message when no entries", () => {
      const { getByText } = renderWithUser(
        <LogViewer messages={[]} toolCalls={[]} />
      );
      expect(getByText("No logs yet. Start the loop to see activity.")).toBeInTheDocument();
    });

    test("renders empty state when only empty arrays provided", () => {
      const { getByText } = renderWithUser(
        <LogViewer messages={[]} toolCalls={[]} logs={[]} />
      );
      expect(getByText("No logs yet. Start the loop to see activity.")).toBeInTheDocument();
    });
  });

  describe("message rendering", () => {
    test("renders a user message with info badge", () => {
      const msg = createMessageData({ role: "user", content: "Hello world" });
      const { getByText } = renderWithUser(
        <LogViewer messages={[msg]} toolCalls={[]} />
      );
      expect(getByText("user")).toBeInTheDocument();
      expect(getByText("Hello world")).toBeInTheDocument();
    });

    test("renders an assistant message with success badge", () => {
      const msg = createMessageData({ role: "assistant", content: "I can help with that" });
      const { getByText } = renderWithUser(
        <LogViewer messages={[msg]} toolCalls={[]} />
      );
      expect(getByText("assistant")).toBeInTheDocument();
      expect(getByText("I can help with that")).toBeInTheDocument();
    });

    test("renders multiple messages", () => {
      const msgs: MessageData[] = [
        createMessageData({ role: "user", content: "First message" }),
        createMessageData({ role: "assistant", content: "Second message" }),
      ];
      const { getByText } = renderWithUser(
        <LogViewer messages={msgs} toolCalls={[]} />
      );
      expect(getByText("First message")).toBeInTheDocument();
      expect(getByText("Second message")).toBeInTheDocument();
    });
  });

  describe("tool call rendering", () => {
    test("renders a completed tool call with check mark", () => {
      const tool = createToolCallData({ name: "Write", status: "completed" });
      const { getByText } = renderWithUser(
        <LogViewer messages={[]} toolCalls={[tool]} />
      );
      expect(getByText("Write")).toBeInTheDocument();
      expect(getByText("✓")).toBeInTheDocument();
    });

    test("renders a failed tool call with X mark", () => {
      const tool = createToolCallData({ name: "Read", status: "failed" });
      const { getByText } = renderWithUser(
        <LogViewer messages={[]} toolCalls={[tool]} />
      );
      expect(getByText("Read")).toBeInTheDocument();
      expect(getByText("✗")).toBeInTheDocument();
    });

    test("renders a pending tool call with circle", () => {
      const tool = createToolCallData({ name: "Bash", status: "pending" });
      const { getByText } = renderWithUser(
        <LogViewer messages={[]} toolCalls={[tool]} />
      );
      expect(getByText("Bash")).toBeInTheDocument();
      expect(getByText("○")).toBeInTheDocument();
    });

    test("renders a running tool call with spinner", () => {
      const tool = createToolCallData({ name: "Glob", status: "running" });
      const { getByText } = renderWithUser(
        <LogViewer messages={[]} toolCalls={[tool]} />
      );
      expect(getByText("Glob")).toBeInTheDocument();
      expect(getByText("⟳")).toBeInTheDocument();
    });

    test("renders tool input in collapsible details", async () => {
      const tool = createToolCallData({
        name: "Write",
        input: { filePath: "/src/test.ts", content: "hello" },
      });
      const { getByText, user } = renderWithUser(
        <LogViewer messages={[]} toolCalls={[tool]} />
      );
      // Input should be in a details/summary element
      const inputSummary = getByText("Input");
      expect(inputSummary).toBeInTheDocument();
      // Clicking the summary should open details (toggle handled by browser)
      await user.click(inputSummary);
    });

    test("renders tool output in collapsible details", async () => {
      const tool = createToolCallData({
        name: "Read",
        output: "file contents here",
      });
      const { getByText } = renderWithUser(
        <LogViewer messages={[]} toolCalls={[tool]} />
      );
      expect(getByText("Output")).toBeInTheDocument();
      expect(getByText("file contents here")).toBeInTheDocument();
    });

    test("renders tool output as JSON when it is an object", () => {
      const tool = createToolCallData({
        name: "Bash",
        output: { exitCode: 0, stdout: "ok" },
      });
      const { container } = renderWithUser(
        <LogViewer messages={[]} toolCalls={[tool]} />
      );
      // JSON stringified output should be in the pre element
      const preElements = container.querySelectorAll("pre");
      const outputPre = Array.from(preElements).find(
        (el) => el.textContent?.includes('"exitCode"')
      );
      expect(outputPre).toBeDefined();
    });

    test("does not render Input details when input is null", () => {
      const tool = createToolCallData({ name: "Write", input: null });
      const { queryByText } = renderWithUser(
        <LogViewer messages={[]} toolCalls={[tool]} />
      );
      expect(queryByText("Input")).not.toBeInTheDocument();
    });

    test("does not render Output details when output is null", () => {
      const tool = createToolCallData({ name: "Write", output: undefined });
      const { queryByText } = renderWithUser(
        <LogViewer messages={[]} toolCalls={[tool]} />
      );
      expect(queryByText("Output")).not.toBeInTheDocument();
    });
  });

  describe("log entry rendering", () => {
    test("renders an info log with INFO badge", () => {
      const log = createLogEntry({ level: "info", message: "Server started" });
      const { getByText } = renderWithUser(
        <LogViewer messages={[]} toolCalls={[]} logs={[log]} />
      );
      expect(getByText("INFO")).toBeInTheDocument();
      expect(getByText("Server started")).toBeInTheDocument();
    });

    test("renders a warn log with WARN badge", () => {
      const log = createLogEntry({ level: "warn", message: "Rate limit approaching" });
      const { getByText } = renderWithUser(
        <LogViewer messages={[]} toolCalls={[]} logs={[log]} />
      );
      expect(getByText("WARN")).toBeInTheDocument();
      expect(getByText("Rate limit approaching")).toBeInTheDocument();
    });

    test("renders an error log with ERROR badge", () => {
      const log = createLogEntry({ level: "error", message: "Connection failed" });
      const { getByText } = renderWithUser(
        <LogViewer messages={[]} toolCalls={[]} logs={[log]} />
      );
      expect(getByText("ERROR")).toBeInTheDocument();
      expect(getByText("Connection failed")).toBeInTheDocument();
    });

    test("renders a debug log with DEBUG badge", () => {
      const log = createLogEntry({ level: "debug", message: "Debug info" });
      const { getByText } = renderWithUser(
        <LogViewer messages={[]} toolCalls={[]} logs={[log]} />
      );
      expect(getByText("DEBUG")).toBeInTheDocument();
      expect(getByText("Debug info")).toBeInTheDocument();
    });

    test("renders an agent log with AGENT badge", () => {
      const log = createLogEntry({ level: "agent", message: "Agent thinking" });
      const { getByText } = renderWithUser(
        <LogViewer messages={[]} toolCalls={[]} logs={[log]} />
      );
      expect(getByText("AGENT")).toBeInTheDocument();
      expect(getByText("Agent thinking")).toBeInTheDocument();
    });

    test("renders log details in collapsible section", () => {
      const log = createLogEntry({
        details: { key: "value", count: 42 },
      });
      const { getByText } = renderWithUser(
        <LogViewer messages={[]} toolCalls={[]} logs={[log]} />
      );
      expect(getByText("Details")).toBeInTheDocument();
    });

    test("does not render Details when log has no details", () => {
      const log = createLogEntry({ details: undefined });
      const { queryByText } = renderWithUser(
        <LogViewer messages={[]} toolCalls={[]} logs={[log]} />
      );
      expect(queryByText("Details")).not.toBeInTheDocument();
    });

    test("renders responseContent as text block, not in Details", () => {
      const log = createLogEntry({
        details: { responseContent: "AI response text here" },
      });
      const { getByText, queryByText } = renderWithUser(
        <LogViewer messages={[]} toolCalls={[]} logs={[log]} />
      );
      // responseContent should be rendered as text
      expect(getByText("AI response text here")).toBeInTheDocument();
      // Should NOT show Details since responseContent is the only detail
      expect(queryByText("Details")).not.toBeInTheDocument();
    });

    test("renders responseContent and other details separately", () => {
      const log = createLogEntry({
        details: {
          responseContent: "AI response",
          otherKey: "otherValue",
        },
      });
      const { getByText } = renderWithUser(
        <LogViewer messages={[]} toolCalls={[]} logs={[log]} />
      );
      // responseContent as text block
      expect(getByText("AI response")).toBeInTheDocument();
      // Other details in collapsible
      expect(getByText("Details")).toBeInTheDocument();
    });
  });

  describe("debug log filtering", () => {
    test("shows debug logs by default (showDebugLogs=true)", () => {
      const logs = [
        createLogEntry({ level: "debug", message: "Debug message" }),
        createLogEntry({ level: "info", message: "Info message" }),
      ];
      const { getByText } = renderWithUser(
        <LogViewer messages={[]} toolCalls={[]} logs={logs} />
      );
      expect(getByText("Debug message")).toBeInTheDocument();
      expect(getByText("Info message")).toBeInTheDocument();
    });

    test("hides debug logs when showDebugLogs=false", () => {
      const logs = [
        createLogEntry({ level: "debug", message: "Debug message" }),
        createLogEntry({ level: "info", message: "Info message" }),
      ];
      const { queryByText, getByText } = renderWithUser(
        <LogViewer messages={[]} toolCalls={[]} logs={logs} showDebugLogs={false} />
      );
      expect(queryByText("Debug message")).not.toBeInTheDocument();
      expect(getByText("Info message")).toBeInTheDocument();
    });

    test("shows empty state when only debug logs exist and showDebugLogs=false", () => {
      const logs = [
        createLogEntry({ level: "debug", message: "Debug only" }),
      ];
      const { getByText } = renderWithUser(
        <LogViewer messages={[]} toolCalls={[]} logs={logs} showDebugLogs={false} />
      );
      expect(getByText("No logs yet. Start the loop to see activity.")).toBeInTheDocument();
    });
  });

  describe("chronological sorting", () => {
    test("sorts entries by timestamp across all types", () => {
      const msg = createMessageData({
        content: "Second entry",
        timestamp: "2026-01-01T00:00:02.000Z",
      });
      const tool = createToolCallData({
        name: "FirstTool",
        timestamp: "2026-01-01T00:00:01.000Z",
      });
      const log = createLogEntry({
        message: "Third entry",
        timestamp: "2026-01-01T00:00:03.000Z",
      });

      const { container } = renderWithUser(
        <LogViewer messages={[msg]} toolCalls={[tool]} logs={[log]} />
      );

      // Get all rendered entry groups
      const groups = container.querySelectorAll(".group");
      expect(groups.length).toBe(3);

      // Verify order: FirstTool (01), Second entry (02), Third entry (03)
      expect(groups[0]?.textContent).toContain("FirstTool");
      expect(groups[1]?.textContent).toContain("Second entry");
      expect(groups[2]?.textContent).toContain("Third entry");
    });
  });

  describe("props", () => {
    test("sets id on the root element", () => {
      const { container } = renderWithUser(
        <LogViewer messages={[]} toolCalls={[]} id="log-viewer-1" />
      );
      const el = container.querySelector("#log-viewer-1");
      expect(el).toBeInTheDocument();
    });

    test("applies maxHeight style when provided", () => {
      const { container } = renderWithUser(
        <LogViewer messages={[]} toolCalls={[]} maxHeight="400px" />
      );
      const root = container.firstElementChild as HTMLElement;
      expect(root.style.maxHeight).toBe("400px");
    });

    test("does not apply maxHeight style when not provided", () => {
      const { container } = renderWithUser(
        <LogViewer messages={[]} toolCalls={[]} />
      );
      const root = container.firstElementChild as HTMLElement;
      expect(root.style.maxHeight).toBe("");
    });

    test("applies flex-1 class when no maxHeight", () => {
      const { container } = renderWithUser(
        <LogViewer messages={[]} toolCalls={[]} />
      );
      const root = container.firstElementChild as HTMLElement;
      expect(root.className).toContain("flex-1");
    });

    test("does not apply flex-1 class when maxHeight is set", () => {
      const { container } = renderWithUser(
        <LogViewer messages={[]} toolCalls={[]} maxHeight="400px" />
      );
      const root = container.firstElementChild as HTMLElement;
      expect(root.className).not.toContain("flex-1");
    });
  });

  describe("mixed content", () => {
    test("renders messages, tool calls, and logs together", () => {
      const messages = [createMessageData({ content: "Hello from user", role: "user" })];
      const toolCalls = [createToolCallData({ name: "Edit", status: "completed" })];
      const logs = [createLogEntry({ level: "info", message: "Processing complete" })];

      const { getByText } = renderWithUser(
        <LogViewer messages={messages} toolCalls={toolCalls} logs={logs} />
      );

      expect(getByText("Hello from user")).toBeInTheDocument();
      expect(getByText("Edit")).toBeInTheDocument();
      expect(getByText("Processing complete")).toBeInTheDocument();
    });
  });
});
