/**
 * Modal component for renaming a loop.
 */

import { useState, useEffect, useRef } from "react";
import { Modal, Button } from "./common";

export interface RenameLoopModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** Current loop name */
  currentName: string;
  /** Callback to rename the loop */
  onRename: (newName: string) => Promise<void>;
}

/**
 * Modal for renaming a loop.
 */
export function RenameLoopModal({
  isOpen,
  onClose,
  currentName,
  onRename,
}: RenameLoopModalProps) {
  const [name, setName] = useState(currentName);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setName(currentName);
      setError(null);
      setLoading(false);
      // Focus and select input text. The ref is already assigned by
      // the time the effect runs (React assigns refs during commit).
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isOpen, currentName]);

  function validateName(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) {
      return "Name cannot be empty";
    }
    if (trimmed.length > 100) {
      return "Name cannot exceed 100 characters";
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    const trimmedName = name.trim();
    const validationError = validateName(trimmedName);
    if (validationError) {
      setError(validationError);
      return;
    }

    // Don't save if name hasn't changed
    if (trimmedName === currentName) {
      onClose();
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await onRename(trimmedName);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  function handleCancel() {
    if (!loading) {
      onClose();
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleCancel}
      title="Rename Loop"
      size="sm"
      closeOnOverlayClick={!loading}
      footer={
        <>
          <Button variant="ghost" onClick={handleCancel} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            loading={loading}
            disabled={!name.trim() || loading}
          >
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        <div>
          <label
            htmlFor="loop-name"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Loop Name
          </label>
          <input
            ref={inputRef}
            id="loop-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            disabled={loading}
            maxLength={100}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md shadow-sm 
                     focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                     dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100
                     disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder="Enter loop name"
          />
          {error && (
            <p className="mt-1 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {name.trim().length}/100 characters
          </p>
        </div>
      </form>
    </Modal>
  );
}
