/**
 * Tests for the Button component.
 */

import { test, expect, describe, mock } from "bun:test";
import { Button } from "@/components/common/Button";
import { renderWithUser } from "../../helpers/render";

describe("Button", () => {
  describe("rendering", () => {
    test("renders children text", () => {
      const { getByRole } = renderWithUser(<Button>Click me</Button>);
      expect(getByRole("button", { name: "Click me" })).toBeInTheDocument();
    });

    test("renders as a button element", () => {
      const { getByRole } = renderWithUser(<Button>Test</Button>);
      expect(getByRole("button")).toBeInTheDocument();
    });
  });

  describe("variants", () => {
    test("applies primary variant classes by default", () => {
      const { getByRole } = renderWithUser(<Button>Primary</Button>);
      const btn = getByRole("button");
      expect(btn.className).toContain("bg-blue-600");
    });

    test("applies secondary variant classes", () => {
      const { getByRole } = renderWithUser(<Button variant="secondary">Secondary</Button>);
      const btn = getByRole("button");
      expect(btn.className).toContain("bg-gray-200");
    });

    test("applies danger variant classes", () => {
      const { getByRole } = renderWithUser(<Button variant="danger">Danger</Button>);
      const btn = getByRole("button");
      expect(btn.className).toContain("bg-red-600");
    });

    test("applies ghost variant classes", () => {
      const { getByRole } = renderWithUser(<Button variant="ghost">Ghost</Button>);
      const btn = getByRole("button");
      expect(btn.className).toContain("bg-transparent");
    });
  });

  describe("sizes", () => {
    test("applies md size classes by default", () => {
      const { getByRole } = renderWithUser(<Button>Medium</Button>);
      const btn = getByRole("button");
      expect(btn.className).toContain("px-4");
      expect(btn.className).toContain("py-2");
    });

    test("applies xs size classes", () => {
      const { getByRole } = renderWithUser(<Button size="xs">XS</Button>);
      const btn = getByRole("button");
      expect(btn.className).toContain("px-1.5");
    });

    test("applies sm size classes", () => {
      const { getByRole } = renderWithUser(<Button size="sm">SM</Button>);
      const btn = getByRole("button");
      expect(btn.className).toContain("px-2");
    });

    test("applies lg size classes", () => {
      const { getByRole } = renderWithUser(<Button size="lg">LG</Button>);
      const btn = getByRole("button");
      expect(btn.className).toContain("px-6");
    });
  });

  describe("states", () => {
    test("can be disabled", () => {
      const { getByRole } = renderWithUser(<Button disabled>Disabled</Button>);
      expect(getByRole("button")).toBeDisabled();
    });

    test("is disabled when loading", () => {
      const { getByRole } = renderWithUser(<Button loading>Loading</Button>);
      expect(getByRole("button")).toBeDisabled();
    });

    test("shows spinner when loading", () => {
      const { getByRole } = renderWithUser(<Button loading>Loading</Button>);
      const btn = getByRole("button");
      // Loading spinner has animate-spin class
      const spinner = btn.querySelector(".animate-spin");
      expect(spinner).not.toBeNull();
    });

    test("does not show spinner when not loading", () => {
      const { getByRole } = renderWithUser(<Button>Normal</Button>);
      const btn = getByRole("button");
      const spinner = btn.querySelector(".animate-spin");
      expect(spinner).toBeNull();
    });
  });

  describe("icon", () => {
    test("renders icon element", () => {
      const { getByTestId } = renderWithUser(
        <Button icon={<span data-testid="icon">*</span>}>With Icon</Button>
      );
      expect(getByTestId("icon")).toBeInTheDocument();
    });

    test("does not render icon wrapper when loading (spinner takes precedence)", () => {
      const { queryByTestId } = renderWithUser(
        <Button loading icon={<span data-testid="icon">*</span>}>Loading</Button>
      );
      expect(queryByTestId("icon")).not.toBeInTheDocument();
    });
  });

  describe("interaction", () => {
    test("calls onClick handler when clicked", async () => {
      const onClick = mock(() => {});
      const { user, getByRole } = renderWithUser(<Button onClick={onClick}>Click</Button>);

      await user.click(getByRole("button"));
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    test("does not call onClick when disabled", async () => {
      const onClick = mock(() => {});
      const { user, getByRole } = renderWithUser(
        <Button onClick={onClick} disabled>Disabled</Button>
      );

      await user.click(getByRole("button"));
      expect(onClick).not.toHaveBeenCalled();
    });

    test("does not call onClick when loading", async () => {
      const onClick = mock(() => {});
      const { user, getByRole } = renderWithUser(
        <Button onClick={onClick} loading>Loading</Button>
      );

      await user.click(getByRole("button"));
      expect(onClick).not.toHaveBeenCalled();
    });
  });

  describe("custom className", () => {
    test("appends custom className", () => {
      const { getByRole } = renderWithUser(<Button className="custom-class">Custom</Button>);
      const btn = getByRole("button");
      expect(btn.className).toContain("custom-class");
    });
  });

  describe("HTML attributes", () => {
    test("forwards type attribute", () => {
      const { getByRole } = renderWithUser(<Button type="submit">Submit</Button>);
      const btn = getByRole("button");
      expect(btn.getAttribute("type")).toBe("submit");
    });

    test("forwards aria attributes", () => {
      const { getByLabelText } = renderWithUser(
        <Button aria-label="Save file">Save</Button>
      );
      expect(getByLabelText("Save file")).toBeInTheDocument();
    });
  });
});
