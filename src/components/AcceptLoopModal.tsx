/**
 * AcceptLoopModal component for finalizing a completed loop.
 * Offers choice between merging locally or pushing to remote.
 */

import { useState } from "react";
import { Modal, Button } from "./common";

export interface AcceptLoopModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** Callback to accept and merge the loop */
  onAccept: () => Promise<void>;
  /** Callback to push the loop to remote */
  onPush: () => Promise<void>;
}

type HoveredOption = "accept" | "push" | null;

/**
 * AcceptLoopModal provides UI for finalizing a completed loop.
 * Users can choose between merging locally or pushing to remote for PR.
 */
export function AcceptLoopModal({
  isOpen,
  onClose,
  onAccept,
  onPush,
}: AcceptLoopModalProps) {
  const [accepting, setAccepting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [hovered, setHovered] = useState<HoveredOption>(null);

  const isLoading = accepting || pushing;

  async function handleAccept() {
    setAccepting(true);
    try {
      await onAccept();
    } finally {
      setAccepting(false);
    }
  }

  async function handlePush() {
    setPushing(true);
    try {
      await onPush();
    } finally {
      setPushing(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Finalize Loop"
      description="Choose how to finalize this loop's changes."
      size="md"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={handlePush}
            loading={pushing}
            disabled={accepting}
            onMouseEnter={() => setHovered("push")}
            onMouseLeave={() => setHovered(null)}
          >
            Push to Remote
          </Button>
          <Button
            variant="secondary"
            onClick={handleAccept}
            loading={accepting}
            disabled={pushing}
            onMouseEnter={() => setHovered("accept")}
            onMouseLeave={() => setHovered(null)}
          >
            Accept & Merge
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div
          className={`p-4 rounded-lg border transition-colors ${
            hovered === "accept"
              ? "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800"
              : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700"
          }`}
        >
          <h4
            className={`font-medium mb-1 transition-colors ${
              hovered === "accept"
                ? "text-blue-900 dark:text-blue-100"
                : "text-gray-900 dark:text-gray-100"
            }`}
          >
            Accept & Merge
          </h4>
          <p
            className={`text-sm transition-colors ${
              hovered === "accept"
                ? "text-blue-700 dark:text-blue-300"
                : "text-gray-600 dark:text-gray-400"
            }`}
          >
            Merge the changes directly into the original branch locally. The working branch will be deleted.
          </p>
        </div>
        <div
          className={`p-4 rounded-lg border transition-colors ${
            hovered === "push"
              ? "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800"
              : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700"
          }`}
        >
          <h4
            className={`font-medium mb-1 transition-colors ${
              hovered === "push"
                ? "text-blue-900 dark:text-blue-100"
                : "text-gray-900 dark:text-gray-100"
            }`}
          >
            Push to Remote
          </h4>
          <p
            className={`text-sm transition-colors ${
              hovered === "push"
                ? "text-blue-700 dark:text-blue-300"
                : "text-gray-600 dark:text-gray-400"
            }`}
          >
            Push the working branch to the remote repository. You can then create a pull request for code review.
          </p>
        </div>
      </div>
    </Modal>
  );
}

export default AcceptLoopModal;
