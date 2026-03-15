/**
 * Tests for the RenameSshSessionModal component.
 */

import { describe, expect, mock, test } from "bun:test";
import { RenameSshSessionModal } from "@/components/RenameSshSessionModal";
import { act, renderWithUser, waitFor } from "../helpers/render";

describe("RenameSshSessionModal", () => {
  const defaultProps = () => ({
    isOpen: true,
    onClose: mock(),
    currentName: "Workspace Shell",
    onRename: mock(() => Promise.resolve()),
  });

  test("renders SSH-specific title and label", () => {
    const { getByText, getByLabelText } = renderWithUser(
      <RenameSshSessionModal {...defaultProps()} />,
    );

    expect(getByText("Rename SSH Session")).toBeInTheDocument();
    expect(getByLabelText("SSH Session Name")).toBeInTheDocument();
  });

  test("submits the trimmed SSH session name", async () => {
    const props = defaultProps();
    const { getByRole, getByLabelText, user } = renderWithUser(
      <RenameSshSessionModal {...props} />,
    );

    const input = getByLabelText("SSH Session Name") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "  Renamed Shell  ");
    await user.click(getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(props.onRename).toHaveBeenCalledWith("Renamed Shell");
      expect(props.onClose).toHaveBeenCalled();
    });
  });

  test("shows validation feedback for an empty name", async () => {
    const { getByLabelText, getByText, user } = renderWithUser(
      <RenameSshSessionModal {...defaultProps()} currentName="" />,
    );

    const input = getByLabelText("SSH Session Name") as HTMLInputElement;
    await user.type(input, "a");
    await user.clear(input);
    await user.type(input, " ");

    const form = input.closest("form");
    if (form) {
      await act(async () => {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
    }

    await waitFor(() => {
      expect(getByText("Name cannot be empty")).toBeInTheDocument();
    });
  });

  test("shows rename failures inline", async () => {
    const props = defaultProps();
    props.onRename = mock(() => Promise.reject(new Error("Rename failed")));

    const { getByRole, getByLabelText, getByText, user } = renderWithUser(
      <RenameSshSessionModal {...props} currentName="Old Name" />,
    );

    const input = getByLabelText("SSH Session Name") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "New Name");
    await user.click(getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(getByText("Error: Rename failed")).toBeInTheDocument();
    });
  });
});
