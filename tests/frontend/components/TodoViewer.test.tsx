/**
 * Tests for the TodoViewer component.
 */

import { test, expect, describe } from "bun:test";
import { TodoViewer } from "@/components/TodoViewer";
import { renderWithUser } from "../helpers/render";
import { createTodoItem } from "../helpers/factories";
import type { TodoItem } from "@/backends/types";

describe("TodoViewer", () => {
  describe("empty state", () => {
    test("renders empty state message when no todos", () => {
      const { getByText } = renderWithUser(<TodoViewer todos={[]} />);
      expect(getByText("No TODOs yet.")).toBeInTheDocument();
    });

    test("does not render todo items when empty", () => {
      const { queryByText } = renderWithUser(<TodoViewer todos={[]} />);
      expect(queryByText("PENDING")).not.toBeInTheDocument();
    });
  });

  describe("rendering todo items", () => {
    test("renders todo content text", () => {
      const todos = [createTodoItem({ content: "Implement feature X" })];
      const { getByText } = renderWithUser(<TodoViewer todos={todos} />);
      expect(getByText("Implement feature X")).toBeInTheDocument();
    });

    test("renders multiple todos", () => {
      const todos = [
        createTodoItem({ content: "First task" }),
        createTodoItem({ content: "Second task" }),
        createTodoItem({ content: "Third task" }),
      ];
      const { getByText } = renderWithUser(<TodoViewer todos={todos} />);
      expect(getByText("First task")).toBeInTheDocument();
      expect(getByText("Second task")).toBeInTheDocument();
      expect(getByText("Third task")).toBeInTheDocument();
    });

    test("does not show empty state when todos exist", () => {
      const todos = [createTodoItem()];
      const { queryByText } = renderWithUser(<TodoViewer todos={todos} />);
      expect(queryByText("No TODOs yet.")).not.toBeInTheDocument();
    });
  });

  describe("status icons", () => {
    test("renders pending icon (○)", () => {
      const todos = [createTodoItem({ status: "pending" })];
      const { getByText } = renderWithUser(<TodoViewer todos={todos} />);
      expect(getByText("○")).toBeInTheDocument();
    });

    test("renders in_progress icon (⟳)", () => {
      const todos = [createTodoItem({ status: "in_progress" })];
      const { getByText } = renderWithUser(<TodoViewer todos={todos} />);
      expect(getByText("⟳")).toBeInTheDocument();
    });

    test("renders completed icon (✓)", () => {
      const todos = [createTodoItem({ status: "completed" })];
      const { getByText } = renderWithUser(<TodoViewer todos={todos} />);
      expect(getByText("✓")).toBeInTheDocument();
    });

    test("renders cancelled icon (✗)", () => {
      const todos = [createTodoItem({ status: "cancelled" })];
      const { getByText } = renderWithUser(<TodoViewer todos={todos} />);
      expect(getByText("✗")).toBeInTheDocument();
    });
  });

  describe("status badges", () => {
    test("renders PENDING badge", () => {
      const todos = [createTodoItem({ status: "pending" })];
      const { getByText } = renderWithUser(<TodoViewer todos={todos} />);
      expect(getByText("PENDING")).toBeInTheDocument();
    });

    test("renders IN PROGRESS badge", () => {
      const todos = [createTodoItem({ status: "in_progress" })];
      const { getByText } = renderWithUser(<TodoViewer todos={todos} />);
      expect(getByText("IN PROGRESS")).toBeInTheDocument();
    });

    test("renders COMPLETED badge", () => {
      const todos = [createTodoItem({ status: "completed" })];
      const { getByText } = renderWithUser(<TodoViewer todos={todos} />);
      expect(getByText("COMPLETED")).toBeInTheDocument();
    });

    test("renders CANCELLED badge", () => {
      const todos = [createTodoItem({ status: "cancelled" })];
      const { getByText } = renderWithUser(<TodoViewer todos={todos} />);
      expect(getByText("CANCELLED")).toBeInTheDocument();
    });
  });

  describe("status colors", () => {
    test("pending todo has gray border", () => {
      const todos = [createTodoItem({ status: "pending", content: "pending-test" })];
      const { getByText } = renderWithUser(<TodoViewer todos={todos} />);
      const content = getByText("pending-test");
      const row = content.closest(".border-l-2");
      expect(row?.className).toContain("border-l-gray-600");
    });

    test("in_progress todo has blue border", () => {
      const todos = [createTodoItem({ status: "in_progress", content: "progress-test" })];
      const { getByText } = renderWithUser(<TodoViewer todos={todos} />);
      const content = getByText("progress-test");
      const row = content.closest(".border-l-2");
      expect(row?.className).toContain("border-l-blue-500");
    });

    test("completed todo has green border", () => {
      const todos = [createTodoItem({ status: "completed", content: "completed-test" })];
      const { getByText } = renderWithUser(<TodoViewer todos={todos} />);
      const content = getByText("completed-test");
      const row = content.closest(".border-l-2");
      expect(row?.className).toContain("border-l-green-500");
    });

    test("cancelled todo has gray border", () => {
      const todos = [createTodoItem({ status: "cancelled", content: "cancelled-test" })];
      const { getByText } = renderWithUser(<TodoViewer todos={todos} />);
      const content = getByText("cancelled-test");
      const row = content.closest(".border-l-2");
      expect(row?.className).toContain("border-l-gray-600");
    });
  });

  describe("text styling", () => {
    test("pending todo has normal text", () => {
      const todos = [createTodoItem({ status: "pending", content: "pending-text" })];
      const { getByText } = renderWithUser(<TodoViewer todos={todos} />);
      const content = getByText("pending-text");
      expect(content.className).toContain("text-gray-100");
    });

    test("in_progress todo has normal text", () => {
      const todos = [createTodoItem({ status: "in_progress", content: "progress-text" })];
      const { getByText } = renderWithUser(<TodoViewer todos={todos} />);
      const content = getByText("progress-text");
      expect(content.className).toContain("text-gray-100");
    });

    test("completed todo has dimmed text", () => {
      const todos = [createTodoItem({ status: "completed", content: "completed-text" })];
      const { getByText } = renderWithUser(<TodoViewer todos={todos} />);
      const content = getByText("completed-text");
      expect(content.className).toContain("text-gray-500");
    });

    test("cancelled todo has dimmed text", () => {
      const todos = [createTodoItem({ status: "cancelled", content: "cancelled-text" })];
      const { getByText } = renderWithUser(<TodoViewer todos={todos} />);
      const content = getByText("cancelled-text");
      expect(content.className).toContain("text-gray-500");
    });
  });

  describe("props", () => {
    test("applies id to root element", () => {
      const { container } = renderWithUser(<TodoViewer todos={[]} id="my-todos" />);
      const root = container.querySelector("#my-todos");
      expect(root).toBeInTheDocument();
    });

    test("applies maxHeight style when provided", () => {
      const { container } = renderWithUser(
        <TodoViewer todos={[]} maxHeight="300px" />
      );
      const root = container.firstElementChild as HTMLElement;
      expect(root.style.maxHeight).toBe("300px");
    });

    test("does not apply maxHeight style when not provided", () => {
      const { container } = renderWithUser(<TodoViewer todos={[]} />);
      const root = container.firstElementChild as HTMLElement;
      expect(root.style.maxHeight).toBe("");
    });

    test("applies flex-1 class when no maxHeight", () => {
      const { container } = renderWithUser(<TodoViewer todos={[]} />);
      const root = container.firstElementChild as HTMLElement;
      expect(root.className).toContain("flex-1");
    });

    test("does not apply flex-1 class when maxHeight provided", () => {
      const { container } = renderWithUser(
        <TodoViewer todos={[]} maxHeight="300px" />
      );
      const root = container.firstElementChild as HTMLElement;
      expect(root.className).not.toContain("flex-1");
    });
  });

  describe("mixed statuses", () => {
    test("renders todos with different statuses correctly", () => {
      const todos: TodoItem[] = [
        createTodoItem({ status: "completed", content: "Done task" }),
        createTodoItem({ status: "in_progress", content: "Current task" }),
        createTodoItem({ status: "pending", content: "Future task" }),
        createTodoItem({ status: "cancelled", content: "Skipped task" }),
      ];
      const { getByText } = renderWithUser(<TodoViewer todos={todos} />);

      // All items rendered
      expect(getByText("Done task")).toBeInTheDocument();
      expect(getByText("Current task")).toBeInTheDocument();
      expect(getByText("Future task")).toBeInTheDocument();
      expect(getByText("Skipped task")).toBeInTheDocument();

      // All status badges rendered
      expect(getByText("COMPLETED")).toBeInTheDocument();
      expect(getByText("IN PROGRESS")).toBeInTheDocument();
      expect(getByText("PENDING")).toBeInTheDocument();
      expect(getByText("CANCELLED")).toBeInTheDocument();

      // All icons rendered
      expect(getByText("✓")).toBeInTheDocument();
      expect(getByText("⟳")).toBeInTheDocument();
      expect(getByText("○")).toBeInTheDocument();
      expect(getByText("✗")).toBeInTheDocument();
    });
  });
});
