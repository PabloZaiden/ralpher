/**
 * AddressCommentsModal component for submitting reviewer comments to a pushed/merged loop.
 * Allows users to provide feedback that the loop will address.
 */

import { useState } from "react";
import { Modal, Button } from "./common";
import { log } from "../lib/logger";

export interface AddressCommentsModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** Callback to submit comments */
  onSubmit: (comments: string) => Promise<void>;
  /** Name of the loop */
  loopName: string;
  /** Current review cycle number */
  reviewCycle: number;
}

/**
 * AddressCommentsModal provides UI for submitting reviewer comments.
 */
export function AddressCommentsModal({
  isOpen,
  onClose,
  onSubmit,
  loopName,
  reviewCycle,
}: AddressCommentsModalProps) {
  const [comments, setComments] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!comments.trim()) {
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(comments);
      // Clear comments and close modal on success
      setComments("");
      onClose();
    } catch (error) {
      // Keep modal open on error so user can retry
      log.error("Failed to submit comments:", error);
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    if (!submitting) {
      setComments("");
      onClose();
    }
  }

  const isValid = comments.trim().length > 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Address Reviewer Comments"
      description={`Submit feedback for "${loopName}" (Review Cycle ${reviewCycle})`}
      size="lg"
      closeOnOverlayClick={!submitting}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={handleClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            loading={submitting}
            disabled={!isValid}
          >
            Submit Comments
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label
            htmlFor="reviewer-comments"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >
            Reviewer Comments
          </label>
          <textarea
            id="reviewer-comments"
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder="Enter your review comments here. Be specific about what needs to be changed or improved..."
            rows={10}
            disabled={submitting}
            className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            The loop will restart and address these comments by making targeted changes to the code.
          </p>
        </div>

        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-3">
          <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-1">
            How it works
          </h4>
          <ul className="text-xs text-blue-800 dark:text-blue-200 space-y-1">
            <li>• The loop will read your comments and update the code accordingly</li>
            <li>• New commits will be added to address each point</li>
            <li>• You can review and provide additional feedback after completion</li>
            <li>• This process can repeat until you're satisfied with the changes</li>
          </ul>
        </div>
      </div>
    </Modal>
  );
}

export default AddressCommentsModal;
