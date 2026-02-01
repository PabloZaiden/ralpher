/**
 * AppSettingsModal component for configuring global app settings.
 * Contains markdown rendering preferences and reset options.
 * Server settings have moved to per-workspace WorkspaceSettingsModal.
 */

import { useState } from "react";
import { Modal, Button } from "./common";
import { useMarkdownPreference } from "../hooks";

export interface AppSettingsModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** Callback to reset all settings (destructive - deletes database) */
  onResetAll?: () => Promise<boolean>;
  /** Whether resetting all is in progress */
  resetting?: boolean;
}

/**
 * AppSettingsModal provides UI for global app settings.
 */
export function AppSettingsModal({
  isOpen,
  onClose,
  onResetAll,
  resetting = false,
}: AppSettingsModalProps) {
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Markdown rendering preference
  const { enabled: markdownEnabled, toggle: toggleMarkdown, saving: savingMarkdown } = useMarkdownPreference();

  // Reset state when modal closes
  function handleClose() {
    setShowResetConfirm(false);
    onClose();
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="App Settings"
      description="Configure global app preferences"
      size="md"
      footer={
        <Button variant="ghost" onClick={handleClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Display Settings */}
        <div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-4">
            Display Settings
          </h3>
          <div className="space-y-3 p-4 rounded-lg bg-gray-50 dark:bg-gray-900">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={markdownEnabled}
                onChange={() => toggleMarkdown()}
                disabled={savingMarkdown}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
              />
              <div>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Render Markdown
                </span>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  When enabled, markdown content (plan, status) is rendered as formatted HTML.
                  When disabled, raw markdown text is shown.
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Server Settings Info */}
        <div className="p-4 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-900/20">
          <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
            Server Settings
          </h3>
          <p className="text-sm text-blue-700 dark:text-blue-300">
            Server connection settings are now configured per workspace.
            Click the gear icon next to a workspace name to edit its connection settings.
            You can also reset a workspace's connection from its settings modal.
          </p>
        </div>

        {/* Reset All Settings - Danger Zone */}
        {onResetAll && (
          <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
            <div className="p-4 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/20">
              <h3 className="text-sm font-medium text-red-800 dark:text-red-200 mb-2">
                Danger Zone
              </h3>
              <p className="text-sm text-red-600 dark:text-red-400 mb-4">
                This will delete all loops, sessions, workspaces, and preferences. This action cannot be undone.
              </p>
              {!showResetConfirm ? (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() => setShowResetConfirm(true)}
                  disabled={resetting}
                >
                  Reset all settings
                </Button>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-red-600 dark:text-red-400">Are you sure?</span>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    onClick={async () => {
                      if (onResetAll) {
                        const success = await onResetAll();
                        if (success) {
                          setShowResetConfirm(false);
                          onClose();
                          // Reload the page to get fresh state
                          window.location.reload();
                        }
                      }
                    }}
                    loading={resetting}
                  >
                    Yes, delete everything
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowResetConfirm(false)}
                    disabled={resetting}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default AppSettingsModal;
