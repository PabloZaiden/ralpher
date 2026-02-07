/**
 * Tests for the LoopModals components (DeleteLoopModal, PurgeLoopModal,
 * MarkMergedModal, UncommittedChangesModal).
 */

import { test, expect, describe } from "bun:test";
import { mock } from "bun:test";
import {
  DeleteLoopModal,
  PurgeLoopModal,
  MarkMergedModal,
  UncommittedChangesModal,
} from "@/components/LoopModals";
import { renderWithUser, waitFor } from "../helpers/render";
import type { UncommittedChangesError } from "@/types/api";

describe("DeleteLoopModal", () => {
  const defaultProps = () => ({
    isOpen: true,
    onClose: mock(),
    onDelete: mock(() => Promise.resolve()),
  });

  test("renders modal title", () => {
    const { getByText } = renderWithUser(
      <DeleteLoopModal {...defaultProps()} />
    );
    expect(getByText("Delete Loop")).toBeInTheDocument();
  });

  test("renders confirmation message", () => {
    const { getByText } = renderWithUser(
      <DeleteLoopModal {...defaultProps()} />
    );
    expect(getByText(/Are you sure you want to delete this loop/)).toBeInTheDocument();
  });

  test("renders Delete and Cancel buttons", () => {
    const { getByRole } = renderWithUser(
      <DeleteLoopModal {...defaultProps()} />
    );
    expect(getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  test("calls onDelete when Delete button clicked", async () => {
    const props = defaultProps();
    const { getByRole, user } = renderWithUser(
      <DeleteLoopModal {...props} />
    );
    await user.click(getByRole("button", { name: "Delete" }));
    expect(props.onDelete).toHaveBeenCalled();
  });

  test("calls onClose when Cancel button clicked", async () => {
    const props = defaultProps();
    const { getByRole, user } = renderWithUser(
      <DeleteLoopModal {...props} />
    );
    await user.click(getByRole("button", { name: "Cancel" }));
    expect(props.onClose).toHaveBeenCalled();
  });

  test("does not render when isOpen is false", () => {
    const { queryByText } = renderWithUser(
      <DeleteLoopModal {...defaultProps()} isOpen={false} />
    );
    expect(queryByText("Delete Loop")).not.toBeInTheDocument();
  });
});

describe("PurgeLoopModal", () => {
  const defaultProps = () => ({
    isOpen: true,
    onClose: mock(),
    onPurge: mock(() => Promise.resolve()),
  });

  test("renders modal title", () => {
    const { getByText } = renderWithUser(
      <PurgeLoopModal {...defaultProps()} />
    );
    expect(getByText("Purge Loop")).toBeInTheDocument();
  });

  test("renders confirmation message about permanent deletion", () => {
    const { getByText } = renderWithUser(
      <PurgeLoopModal {...defaultProps()} />
    );
    expect(getByText(/permanently delete this loop/)).toBeInTheDocument();
  });

  test("renders Purge and Cancel buttons", () => {
    const { getByRole } = renderWithUser(
      <PurgeLoopModal {...defaultProps()} />
    );
    expect(getByRole("button", { name: "Purge" })).toBeInTheDocument();
    expect(getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  test("calls onPurge when Purge button clicked", async () => {
    const props = defaultProps();
    const { getByRole, user } = renderWithUser(
      <PurgeLoopModal {...props} />
    );
    await user.click(getByRole("button", { name: "Purge" }));
    expect(props.onPurge).toHaveBeenCalled();
  });

  test("calls onClose when Cancel button clicked", async () => {
    const props = defaultProps();
    const { getByRole, user } = renderWithUser(
      <PurgeLoopModal {...props} />
    );
    await user.click(getByRole("button", { name: "Cancel" }));
    expect(props.onClose).toHaveBeenCalled();
  });

  test("does not render when isOpen is false", () => {
    const { queryByText } = renderWithUser(
      <PurgeLoopModal {...defaultProps()} isOpen={false} />
    );
    expect(queryByText("Purge Loop")).not.toBeInTheDocument();
  });
});

describe("MarkMergedModal", () => {
  const defaultProps = () => ({
    isOpen: true,
    onClose: mock(),
    onMarkMerged: mock(() => Promise.resolve()),
  });

  test("renders modal title", () => {
    const { getByRole } = renderWithUser(
      <MarkMergedModal {...defaultProps()} />
    );
    // Title is in a heading element
    expect(getByRole("heading", { name: "Mark as Merged" })).toBeInTheDocument();
  });

  test("renders confirmation message about branch handling", () => {
    const { getByText } = renderWithUser(
      <MarkMergedModal {...defaultProps()} />
    );
    expect(getByText(/switch your repository back to the original branch/)).toBeInTheDocument();
  });

  test("renders Mark as Merged and Cancel buttons", () => {
    const { getByRole } = renderWithUser(
      <MarkMergedModal {...defaultProps()} />
    );
    expect(getByRole("button", { name: "Mark as Merged" })).toBeInTheDocument();
    expect(getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  test("calls onMarkMerged when confirm button clicked", async () => {
    const props = defaultProps();
    const { getByRole, user } = renderWithUser(
      <MarkMergedModal {...props} />
    );
    await user.click(getByRole("button", { name: "Mark as Merged" }));
    expect(props.onMarkMerged).toHaveBeenCalled();
  });

  test("calls onClose when Cancel button clicked", async () => {
    const props = defaultProps();
    const { getByRole, user } = renderWithUser(
      <MarkMergedModal {...props} />
    );
    await user.click(getByRole("button", { name: "Cancel" }));
    expect(props.onClose).toHaveBeenCalled();
  });

  test("does not render when isOpen is false", () => {
    const { queryByText } = renderWithUser(
      <MarkMergedModal {...defaultProps()} isOpen={false} />
    );
    expect(queryByText("Mark as Merged")).not.toBeInTheDocument();
  });
});

describe("UncommittedChangesModal", () => {
  const defaultProps = () => ({
    isOpen: true,
    onClose: mock(),
    error: {
      error: "uncommitted_changes" as const,
      message: "You have uncommitted changes in the workspace.",
      changedFiles: ["src/index.ts", "src/utils.ts", "README.md"],
    } as UncommittedChangesError,
  });

  test("renders modal title", () => {
    const { getByText } = renderWithUser(
      <UncommittedChangesModal {...defaultProps()} />
    );
    expect(getByText("Cannot Start Loop")).toBeInTheDocument();
  });

  test("renders error message", () => {
    const { getByText } = renderWithUser(
      <UncommittedChangesModal {...defaultProps()} />
    );
    expect(getByText("You have uncommitted changes in the workspace.")).toBeInTheDocument();
  });

  test("renders commit/stash advice", () => {
    const { getByText } = renderWithUser(
      <UncommittedChangesModal {...defaultProps()} />
    );
    expect(getByText(/Please commit or stash your changes/)).toBeInTheDocument();
  });

  test("renders changed files header", () => {
    const { getByText } = renderWithUser(
      <UncommittedChangesModal {...defaultProps()} />
    );
    expect(getByText("Changed files:")).toBeInTheDocument();
  });

  test("renders list of changed files", () => {
    const { getByText } = renderWithUser(
      <UncommittedChangesModal {...defaultProps()} />
    );
    expect(getByText("src/index.ts")).toBeInTheDocument();
    expect(getByText("src/utils.ts")).toBeInTheDocument();
    expect(getByText("README.md")).toBeInTheDocument();
  });

  test("truncates file list to 10 items with overflow message", () => {
    const files = Array.from({ length: 15 }, (_, i) => `file-${i + 1}.ts`);
    const props = {
      isOpen: true,
      onClose: mock(),
      error: {
        error: "uncommitted_changes" as const,
        message: "Uncommitted changes",
        changedFiles: files,
      } as UncommittedChangesError,
    };
    const { getByText, queryByText } = renderWithUser(
      <UncommittedChangesModal {...props} />
    );
    // First 10 should be visible
    expect(getByText("file-1.ts")).toBeInTheDocument();
    expect(getByText("file-10.ts")).toBeInTheDocument();
    // File 11+ should not be visible individually
    expect(queryByText("file-11.ts")).not.toBeInTheDocument();
    // Overflow message
    expect(getByText("...and 5 more")).toBeInTheDocument();
  });

  test("does not show changed files section when empty", () => {
    const props = {
      isOpen: true,
      onClose: mock(),
      error: {
        error: "uncommitted_changes" as const,
        message: "Uncommitted changes",
        changedFiles: [],
      } as UncommittedChangesError,
    };
    const { queryByText } = renderWithUser(
      <UncommittedChangesModal {...props} />
    );
    expect(queryByText("Changed files:")).not.toBeInTheDocument();
  });

  test("renders Close button in footer", () => {
    const { getAllByRole } = renderWithUser(
      <UncommittedChangesModal {...defaultProps()} />
    );
    // There are two Close buttons: the X icon button (aria-label) and the footer button
    const closeButtons = getAllByRole("button", { name: "Close" });
    expect(closeButtons.length).toBeGreaterThanOrEqual(1);
  });

  test("calls onClose when footer Close button clicked", async () => {
    const props = defaultProps();
    const { getAllByRole, user } = renderWithUser(
      <UncommittedChangesModal {...props} />
    );
    // Get the footer Close button (last one, after the X icon button)
    const closeButtons = getAllByRole("button", { name: "Close" });
    const footerCloseButton = closeButtons[closeButtons.length - 1]!;
    await user.click(footerCloseButton);
    expect(props.onClose).toHaveBeenCalled();
  });

  test("does not render when isOpen is false", () => {
    const { queryByText } = renderWithUser(
      <UncommittedChangesModal {...defaultProps()} isOpen={false} />
    );
    expect(queryByText("Cannot Start Loop")).not.toBeInTheDocument();
  });

  test("renders nothing in body when error is null", () => {
    const { queryByText } = renderWithUser(
      <UncommittedChangesModal isOpen={true} onClose={mock()} error={null} />
    );
    expect(queryByText("Cannot Start Loop")).toBeInTheDocument();
    expect(queryByText("Changed files:")).not.toBeInTheDocument();
    expect(queryByText(/Please commit or stash/)).not.toBeInTheDocument();
  });
});
