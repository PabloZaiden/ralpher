/**
 * Shared modal components for loop actions.
 * These are used by both Dashboard and LoopDetails.
 */

import { useState } from "react";
import type { UncommittedChangesError } from "../types";
import { Modal, ConfirmModal, Button } from "./common";

// ============================================================================
// Delete Loop Modal
// ============================================================================

export interface DeleteLoopModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** Callback to delete the loop */
  onDelete: () => Promise<void>;
}

/**
 * Modal for confirming loop deletion.
 */
export function DeleteLoopModal({
  isOpen,
  onClose,
  onDelete,
}: DeleteLoopModalProps) {
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    try {
      await onDelete();
    } finally {
      setLoading(false);
    }
  }

  return (
    <ConfirmModal
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={handleConfirm}
      title="Delete Loop"
      message="Are you sure you want to delete this loop? The loop will be marked as deleted and can be purged later to permanently remove it."
      confirmLabel="Delete"
      loading={loading}
      variant="danger"
    />
  );
}

// ============================================================================
// Purge Loop Modal
// ============================================================================

export interface PurgeLoopModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** Callback to purge the loop */
  onPurge: () => Promise<void>;
}

/**
 * Modal for confirming loop purge (permanent deletion).
 */
export function PurgeLoopModal({
  isOpen,
  onClose,
  onPurge,
}: PurgeLoopModalProps) {
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    try {
      await onPurge();
    } finally {
      setLoading(false);
    }
  }

  return (
    <ConfirmModal
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={handleConfirm}
      title="Purge Loop"
      message="Are you sure you want to permanently delete this loop? This will remove all loop data and cannot be undone."
      confirmLabel="Purge"
      loading={loading}
      variant="danger"
    />
  );
}

// ============================================================================
// Uncommitted Changes Modal
// ============================================================================

export interface UncommittedChangesModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** The error containing uncommitted changes info */
  error: UncommittedChangesError | null;
}

/**
 * Modal for showing uncommitted changes error when starting a loop.
 * This modal only displays the error - user must manually clean their working directory.
 */
export function UncommittedChangesModal({
  isOpen,
  onClose,
  error,
}: UncommittedChangesModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Cannot Start Loop"
      size="md"
      footer={
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {error && (
        <div>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
            {error.message}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
            Please commit or stash your changes before starting a loop.
          </p>
          {error.changedFiles.length > 0 && (
            <div className="bg-gray-50 dark:bg-gray-900 rounded-md p-3">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Changed files:
              </p>
              <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                {error.changedFiles.slice(0, 10).map((file) => (
                  <li key={file} className="font-mono truncate">
                    {file}
                  </li>
                ))}
                {error.changedFiles.length > 10 && (
                  <li className="text-gray-500">
                    ...and {error.changedFiles.length - 10} more
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ============================================================================
// Re-export AcceptLoopModal for convenience
// ============================================================================

export { AcceptLoopModal, type AcceptLoopModalProps } from "./AcceptLoopModal";
