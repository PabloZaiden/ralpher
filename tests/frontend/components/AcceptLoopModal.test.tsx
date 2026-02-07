/**
 * Tests for the AcceptLoopModal component.
 */

import { test, expect, describe } from "bun:test";
import { mock } from "bun:test";
import { AcceptLoopModal } from "@/components/AcceptLoopModal";
import { renderWithUser, waitFor } from "../helpers/render";

describe("AcceptLoopModal", () => {
  const defaultProps = () => ({
    isOpen: true,
    onClose: mock(),
    onAccept: mock(() => Promise.resolve()),
    onPush: mock(() => Promise.resolve()),
  });

  describe("default rendering (no restrictToAction)", () => {
    test("renders modal title 'Finalize Loop'", () => {
      const { getByText } = renderWithUser(
        <AcceptLoopModal {...defaultProps()} />
      );
      expect(getByText("Finalize Loop")).toBeInTheDocument();
    });

    test("renders modal description", () => {
      const { getByText } = renderWithUser(
        <AcceptLoopModal {...defaultProps()} />
      );
      expect(getByText("Choose how to finalize this loop's changes.")).toBeInTheDocument();
    });

    test("renders Push to Remote button", () => {
      const { getByText } = renderWithUser(
        <AcceptLoopModal {...defaultProps()} />
      );
      expect(getByText("Push to Remote")).toBeInTheDocument();
    });

    test("renders Accept & Merge button", () => {
      const { getByText } = renderWithUser(
        <AcceptLoopModal {...defaultProps()} />
      );
      expect(getByText("Accept & Merge")).toBeInTheDocument();
    });

    test("shows (recommended) label on Push button", () => {
      const { getByText } = renderWithUser(
        <AcceptLoopModal {...defaultProps()} />
      );
      expect(getByText("(recommended)")).toBeInTheDocument();
    });

    test("renders push description", () => {
      const { getByText } = renderWithUser(
        <AcceptLoopModal {...defaultProps()} />
      );
      expect(getByText(/Push the working branch to remote/)).toBeInTheDocument();
    });

    test("renders merge description", () => {
      const { getByText } = renderWithUser(
        <AcceptLoopModal {...defaultProps()} />
      );
      expect(getByText(/Merge changes into the original branch locally/)).toBeInTheDocument();
    });

    test("renders Cancel button in footer", () => {
      const { getByRole } = renderWithUser(
        <AcceptLoopModal {...defaultProps()} />
      );
      expect(getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    });

    test("renders push icon (arrow up)", () => {
      const { getByText } = renderWithUser(
        <AcceptLoopModal {...defaultProps()} />
      );
      expect(getByText("↑")).toBeInTheDocument();
    });

    test("renders merge icon (checkmark)", () => {
      const { getByText } = renderWithUser(
        <AcceptLoopModal {...defaultProps()} />
      );
      expect(getByText("✓")).toBeInTheDocument();
    });
  });

  describe("restrictToAction='push'", () => {
    test("renders 'Finalize Review Cycle' title", () => {
      const { getByText } = renderWithUser(
        <AcceptLoopModal {...defaultProps()} restrictToAction="push" />
      );
      expect(getByText("Finalize Review Cycle")).toBeInTheDocument();
    });

    test("renders push-specific description", () => {
      const { getByText } = renderWithUser(
        <AcceptLoopModal {...defaultProps()} restrictToAction="push" />
      );
      expect(getByText(/This loop was originally pushed/)).toBeInTheDocument();
    });

    test("shows Push to Remote button", () => {
      const { getByText } = renderWithUser(
        <AcceptLoopModal {...defaultProps()} restrictToAction="push" />
      );
      expect(getByText("Push to Remote")).toBeInTheDocument();
    });

    test("hides Accept & Merge button", () => {
      const { queryByText } = renderWithUser(
        <AcceptLoopModal {...defaultProps()} restrictToAction="push" />
      );
      expect(queryByText("Accept & Merge")).not.toBeInTheDocument();
    });

    test("does not show (recommended) label", () => {
      const { queryByText } = renderWithUser(
        <AcceptLoopModal {...defaultProps()} restrictToAction="push" />
      );
      expect(queryByText("(recommended)")).not.toBeInTheDocument();
    });
  });

  describe("restrictToAction='merge'", () => {
    test("renders 'Finalize Review Cycle' title", () => {
      const { getByText } = renderWithUser(
        <AcceptLoopModal {...defaultProps()} restrictToAction="merge" />
      );
      expect(getByText("Finalize Review Cycle")).toBeInTheDocument();
    });

    test("renders merge-specific description", () => {
      const { getByText } = renderWithUser(
        <AcceptLoopModal {...defaultProps()} restrictToAction="merge" />
      );
      expect(getByText(/This loop was originally merged/)).toBeInTheDocument();
    });

    test("shows Accept & Merge button", () => {
      const { getByText } = renderWithUser(
        <AcceptLoopModal {...defaultProps()} restrictToAction="merge" />
      );
      expect(getByText("Accept & Merge")).toBeInTheDocument();
    });

    test("hides Push to Remote button", () => {
      const { queryByText } = renderWithUser(
        <AcceptLoopModal {...defaultProps()} restrictToAction="merge" />
      );
      expect(queryByText("Push to Remote")).not.toBeInTheDocument();
    });
  });

  describe("actions", () => {
    test("calls onPush when Push to Remote clicked", async () => {
      const props = defaultProps();
      const { getByText, user } = renderWithUser(
        <AcceptLoopModal {...props} />
      );
      // Find the push button by its parent containing "Push to Remote"
      const pushText = getByText("Push to Remote");
      const pushButton = pushText.closest("button")!;
      await user.click(pushButton);
      expect(props.onPush).toHaveBeenCalled();
    });

    test("calls onAccept when Accept & Merge clicked", async () => {
      const props = defaultProps();
      const { getByText, user } = renderWithUser(
        <AcceptLoopModal {...props} />
      );
      const mergeText = getByText("Accept & Merge");
      const mergeButton = mergeText.closest("button")!;
      await user.click(mergeButton);
      expect(props.onAccept).toHaveBeenCalled();
    });

    test("calls onClose when Cancel button clicked", async () => {
      const props = defaultProps();
      const { getByRole, user } = renderWithUser(
        <AcceptLoopModal {...props} />
      );
      await user.click(getByRole("button", { name: "Cancel" }));
      expect(props.onClose).toHaveBeenCalled();
    });
  });

  describe("loading state", () => {
    test("disables buttons while pushing", async () => {
      let resolvePromise: () => void;
      const pushPromise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });
      const props = defaultProps();
      props.onPush = mock(() => pushPromise);

      const { getByText, user } = renderWithUser(
        <AcceptLoopModal {...props} />
      );

      const pushButton = getByText("Push to Remote").closest("button")!;
      await user.click(pushButton);

      // Both action buttons should be disabled while pushing
      await waitFor(() => {
        const mergeButton = getByText("Accept & Merge").closest("button")!;
        expect(pushButton).toBeDisabled();
        expect(mergeButton).toBeDisabled();
      });

      // Resolve the promise
      resolvePromise!();
    });

    test("disables buttons while accepting", async () => {
      let resolvePromise: () => void;
      const acceptPromise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });
      const props = defaultProps();
      props.onAccept = mock(() => acceptPromise);

      const { getByText, user } = renderWithUser(
        <AcceptLoopModal {...props} />
      );

      const mergeButton = getByText("Accept & Merge").closest("button")!;
      await user.click(mergeButton);

      // Both action buttons should be disabled while accepting
      await waitFor(() => {
        const pushButton = getByText("Push to Remote").closest("button")!;
        expect(pushButton).toBeDisabled();
        expect(mergeButton).toBeDisabled();
      });

      // Resolve the promise
      resolvePromise!();
    });
  });

  describe("not rendered when closed", () => {
    test("does not render content when isOpen is false", () => {
      const { queryByText } = renderWithUser(
        <AcceptLoopModal {...defaultProps()} isOpen={false} />
      );
      expect(queryByText("Finalize Loop")).not.toBeInTheDocument();
    });
  });
});
