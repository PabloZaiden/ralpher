/**
 * Tests for the Modal and ConfirmModal components.
 */

import { test, expect, describe, mock } from "bun:test";
import { Modal, ConfirmModal } from "@/components/common/Modal";
import { renderWithUser } from "../../helpers/render";

describe("Modal", () => {
  describe("visibility", () => {
    test("renders nothing when isOpen is false", () => {
      const { queryByRole } = renderWithUser(
        <Modal isOpen={false} onClose={() => {}} title="Test Modal">
          <p>Content</p>
        </Modal>
      );
      expect(queryByRole("dialog")).not.toBeInTheDocument();
    });

    test("renders modal when isOpen is true", () => {
      const { getByRole } = renderWithUser(
        <Modal isOpen={true} onClose={() => {}} title="Test Modal">
          <p>Content</p>
        </Modal>
      );
      expect(getByRole("dialog")).toBeInTheDocument();
    });
  });

  describe("content", () => {
    test("renders title", () => {
      const { getByText } = renderWithUser(
        <Modal isOpen={true} onClose={() => {}} title="My Modal Title">
          <p>Content</p>
        </Modal>
      );
      expect(getByText("My Modal Title")).toBeInTheDocument();
    });

    test("renders description when provided", () => {
      const { getByText } = renderWithUser(
        <Modal
          isOpen={true}
          onClose={() => {}}
          title="Title"
          description="A helpful description"
        >
          <p>Content</p>
        </Modal>
      );
      expect(getByText("A helpful description")).toBeInTheDocument();
    });

    test("does not render description when not provided", () => {
      const { queryByText } = renderWithUser(
        <Modal isOpen={true} onClose={() => {}} title="Title">
          <p>Content</p>
        </Modal>
      );
      // Only the title and content should be present
      expect(queryByText("A helpful description")).not.toBeInTheDocument();
    });

    test("renders children content", () => {
      const { getByText } = renderWithUser(
        <Modal isOpen={true} onClose={() => {}} title="Title">
          <p>Modal body content</p>
        </Modal>
      );
      expect(getByText("Modal body content")).toBeInTheDocument();
    });

    test("renders footer when provided", () => {
      const { getByText } = renderWithUser(
        <Modal
          isOpen={true}
          onClose={() => {}}
          title="Title"
          footer={<button>Save</button>}
        >
          <p>Content</p>
        </Modal>
      );
      expect(getByText("Save")).toBeInTheDocument();
    });

    test("does not render footer when not provided", () => {
      const { queryByText } = renderWithUser(
        <Modal isOpen={true} onClose={() => {}} title="Title">
          <p>Content</p>
        </Modal>
      );
      expect(queryByText("Save")).not.toBeInTheDocument();
    });
  });

  describe("close button", () => {
    test("renders close button by default", () => {
      const { getByLabelText } = renderWithUser(
        <Modal isOpen={true} onClose={() => {}} title="Title">
          <p>Content</p>
        </Modal>
      );
      expect(getByLabelText("Close")).toBeInTheDocument();
    });

    test("hides close button when showCloseButton is false", () => {
      const { queryByLabelText } = renderWithUser(
        <Modal
          isOpen={true}
          onClose={() => {}}
          title="Title"
          showCloseButton={false}
        >
          <p>Content</p>
        </Modal>
      );
      expect(queryByLabelText("Close")).not.toBeInTheDocument();
    });

    test("calls onClose when close button is clicked", async () => {
      const onClose = mock(() => {});
      const { user, getByLabelText } = renderWithUser(
        <Modal isOpen={true} onClose={onClose} title="Title">
          <p>Content</p>
        </Modal>
      );

      await user.click(getByLabelText("Close"));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("escape key", () => {
    test("calls onClose on Escape key press", async () => {
      const onClose = mock(() => {});
      const { user } = renderWithUser(
        <Modal isOpen={true} onClose={onClose} title="Title">
          <p>Content</p>
        </Modal>
      );

      await user.keyboard("{Escape}");
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("overlay click", () => {
    test("calls onClose when overlay is clicked (default)", async () => {
      const onClose = mock(() => {});
      const { user } = renderWithUser(
        <Modal isOpen={true} onClose={onClose} title="Title">
          <p>Content</p>
        </Modal>
      );

      // The overlay has aria-hidden="true"
      const overlay = document.querySelector("[aria-hidden='true']");
      expect(overlay).not.toBeNull();
      await user.click(overlay!);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    test("does not call onClose when closeOnOverlayClick is false", async () => {
      const onClose = mock(() => {});
      const { user } = renderWithUser(
        <Modal
          isOpen={true}
          onClose={onClose}
          title="Title"
          closeOnOverlayClick={false}
        >
          <p>Content</p>
        </Modal>
      );

      const overlay = document.querySelector("[aria-hidden='true']");
      expect(overlay).not.toBeNull();
      await user.click(overlay!);
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("body scroll lock", () => {
    test("prevents body scroll when open", () => {
      renderWithUser(
        <Modal isOpen={true} onClose={() => {}} title="Title">
          <p>Content</p>
        </Modal>
      );
      expect(document.body.style.overflow).toBe("hidden");
    });
  });

  describe("size", () => {
    test("applies md size class by default", () => {
      const { getByRole } = renderWithUser(
        <Modal isOpen={true} onClose={() => {}} title="Title">
          <p>Content</p>
        </Modal>
      );
      const dialog = getByRole("dialog");
      expect(dialog.className).toContain("max-w-md");
    });

    test("applies sm size class", () => {
      const { getByRole } = renderWithUser(
        <Modal isOpen={true} onClose={() => {}} title="Title" size="sm">
          <p>Content</p>
        </Modal>
      );
      const dialog = getByRole("dialog");
      expect(dialog.className).toContain("max-w-sm");
    });

    test("applies lg size class", () => {
      const { getByRole } = renderWithUser(
        <Modal isOpen={true} onClose={() => {}} title="Title" size="lg">
          <p>Content</p>
        </Modal>
      );
      const dialog = getByRole("dialog");
      expect(dialog.className).toContain("max-w-lg");
    });

    test("applies xl size class", () => {
      const { getByRole } = renderWithUser(
        <Modal isOpen={true} onClose={() => {}} title="Title" size="xl">
          <p>Content</p>
        </Modal>
      );
      const dialog = getByRole("dialog");
      expect(dialog.className).toContain("max-w-xl");
    });
  });

  describe("accessibility", () => {
    test("has aria-modal attribute", () => {
      const { getByRole } = renderWithUser(
        <Modal isOpen={true} onClose={() => {}} title="Title">
          <p>Content</p>
        </Modal>
      );
      const dialog = getByRole("dialog");
      expect(dialog.getAttribute("aria-modal")).toBe("true");
    });

    test("has aria-labelledby pointing to title", () => {
      const { getByRole, getByText } = renderWithUser(
        <Modal isOpen={true} onClose={() => {}} title="Title">
          <p>Content</p>
        </Modal>
      );
      const dialog = getByRole("dialog");
      expect(dialog.getAttribute("aria-labelledby")).toBe("modal-title");
      // Verify the title has the matching id
      const title = getByText("Title");
      expect(title.id).toBe("modal-title");
    });
  });
});

describe("ConfirmModal", () => {
  test("renders title and message", () => {
    const { getByText } = renderWithUser(
      <ConfirmModal
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        title="Delete Item?"
        message="This action cannot be undone."
      />
    );
    expect(getByText("Delete Item?")).toBeInTheDocument();
    expect(getByText("This action cannot be undone.")).toBeInTheDocument();
  });

  test("renders default button labels", () => {
    const { getByRole, getByText } = renderWithUser(
      <ConfirmModal
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        title="Confirm Action"
        message="Are you sure?"
      />
    );
    // Confirm button (default label)
    expect(getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    // Cancel button (default label)
    expect(getByText("Cancel")).toBeInTheDocument();
  });

  test("renders custom button labels", () => {
    const { getByText } = renderWithUser(
      <ConfirmModal
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        title="Title"
        message="Message"
        confirmLabel="Yes, delete"
        cancelLabel="No, keep"
      />
    );
    expect(getByText("Yes, delete")).toBeInTheDocument();
    expect(getByText("No, keep")).toBeInTheDocument();
  });

  test("calls onConfirm when confirm button is clicked", async () => {
    const onConfirm = mock(() => {});
    const { user, getByRole } = renderWithUser(
      <ConfirmModal
        isOpen={true}
        onClose={() => {}}
        onConfirm={onConfirm}
        title="Confirm Action"
        message="Sure?"
      />
    );

    await user.click(getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test("calls onClose when cancel button is clicked", async () => {
    const onClose = mock(() => {});
    const { user, getByText } = renderWithUser(
      <ConfirmModal
        isOpen={true}
        onClose={onClose}
        onConfirm={() => {}}
        title="Confirm"
        message="Sure?"
      />
    );

    await user.click(getByText("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("shows loading state on confirm button", () => {
    const { getByText } = renderWithUser(
      <ConfirmModal
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        title="Confirm"
        message="Sure?"
        loading={true}
      />
    );

    // Cancel button should be disabled when loading
    const cancelBtn = getByText("Cancel").closest("button");
    expect(cancelBtn).toBeDisabled();
  });

  test("disables cancel button when loading", () => {
    const { getByText } = renderWithUser(
      <ConfirmModal
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        title="Confirm"
        message="Sure?"
        loading={true}
      />
    );

    const cancelBtn = getByText("Cancel").closest("button");
    expect(cancelBtn).toBeDisabled();
  });
});
