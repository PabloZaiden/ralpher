/**
 * Tests for the Card component.
 */

import { test, expect, describe, mock } from "bun:test";
import { Card } from "@/components/common/Card";
import { renderWithUser } from "../../helpers/render";

describe("Card", () => {
  describe("rendering", () => {
    test("renders as a div element", () => {
      const { getByTestId } = renderWithUser(<Card data-testid="card">Content</Card>);
      const card = getByTestId("card");
      expect(card.tagName).toBe("DIV");
    });

    test("renders children content", () => {
      const { getByText } = renderWithUser(<Card>Card body content</Card>);
      expect(getByText("Card body content")).toBeInTheDocument();
    });

    test("renders without children", () => {
      const { getByTestId } = renderWithUser(<Card data-testid="empty-card" title="Empty" />);
      expect(getByTestId("empty-card")).toBeInTheDocument();
    });
  });

  describe("header", () => {
    test("renders title when provided", () => {
      const { getByText } = renderWithUser(<Card title="Card Title">Content</Card>);
      expect(getByText("Card Title")).toBeInTheDocument();
    });

    test("renders description when provided", () => {
      const { getByText } = renderWithUser(
        <Card title="Title" description="A description">
          Content
        </Card>
      );
      expect(getByText("A description")).toBeInTheDocument();
    });

    test("renders header actions when provided", () => {
      const { getByText } = renderWithUser(
        <Card
          title="Title"
          headerActions={<button>Action</button>}
        >
          Content
        </Card>
      );
      expect(getByText("Action")).toBeInTheDocument();
    });

    test("does not render header when no title, description, or actions", () => {
      const { getByTestId } = renderWithUser(<Card data-testid="no-header">Content</Card>);
      const card = getByTestId("no-header");
      // No border-b (header separator) should exist
      const headerDivs = card.querySelectorAll(".border-b");
      expect(headerDivs.length).toBe(0);
    });

    test("renders header when only headerActions is provided", () => {
      const { getByText } = renderWithUser(
        <Card headerActions={<button>Action</button>}>Content</Card>
      );
      expect(getByText("Action")).toBeInTheDocument();
    });
  });

  describe("clickable", () => {
    test("is not clickable by default", () => {
      const { getByTestId } = renderWithUser(<Card data-testid="card">Content</Card>);
      const card = getByTestId("card");
      expect(card.className).not.toContain("cursor-pointer");
    });

    test("adds cursor-pointer class when clickable", () => {
      const { getByTestId } = renderWithUser(
        <Card data-testid="card" clickable>
          Content
        </Card>
      );
      const card = getByTestId("card");
      expect(card.className).toContain("cursor-pointer");
    });

    test("adds hover styles when clickable", () => {
      const { getByTestId } = renderWithUser(
        <Card data-testid="card" clickable>
          Content
        </Card>
      );
      const card = getByTestId("card");
      expect(card.className).toContain("hover:shadow-md");
    });

    test("handles click events via onClick prop", async () => {
      const onClick = mock(() => {});
      const { user, getByTestId } = renderWithUser(
        <Card data-testid="card" clickable onClick={onClick}>
          Content
        </Card>
      );

      await user.click(getByTestId("card"));
      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });

  describe("padding", () => {
    test("adds padding to content by default", () => {
      const { getByTestId } = renderWithUser(<Card data-testid="card">Content</Card>);
      const card = getByTestId("card");
      const contentDiv = card.querySelector(".p-4");
      expect(contentDiv).not.toBeNull();
    });

    test("removes padding when padding is false", () => {
      const { getByTestId } = renderWithUser(
        <Card data-testid="card" padding={false}>
          Content
        </Card>
      );
      const card = getByTestId("card");
      // Content wrapper should not have p-4
      const contentDiv = card.querySelector(".p-4");
      expect(contentDiv).toBeNull();
    });
  });

  describe("custom className", () => {
    test("appends custom className", () => {
      const { getByTestId } = renderWithUser(
        <Card data-testid="card" className="custom-class">
          Content
        </Card>
      );
      const card = getByTestId("card");
      expect(card.className).toContain("custom-class");
    });
  });

  describe("base styling", () => {
    test("has rounded borders", () => {
      const { getByTestId } = renderWithUser(<Card data-testid="card">Content</Card>);
      const card = getByTestId("card");
      expect(card.className).toContain("rounded-lg");
    });

    test("has border", () => {
      const { getByTestId } = renderWithUser(<Card data-testid="card">Content</Card>);
      const card = getByTestId("card");
      expect(card.className).toContain("border");
    });

    test("has shadow", () => {
      const { getByTestId } = renderWithUser(<Card data-testid="card">Content</Card>);
      const card = getByTestId("card");
      expect(card.className).toContain("shadow-sm");
    });
  });
});
