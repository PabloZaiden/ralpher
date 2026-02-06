/**
 * AppSettingsModal component for configuring global app settings.
 * Contains markdown rendering preferences, log level settings, and reset options.
 * Server settings have moved to per-workspace WorkspaceSettingsModal.
 */

import { useState } from "react";
import { Modal, Button } from "./common";
import { useMarkdownPreference, useLogLevelPreference } from "../hooks";
import type { LogLevelName } from "../lib/logger";

export interface AppSettingsModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** Callback to reset all settings (destructive - deletes database) */
  onResetAll?: () => Promise<boolean>;
  /** Whether resetting all is in progress */
  resetting?: boolean;
  /** Callback to kill the server (for container restart) */
  onKillServer?: () => Promise<boolean>;
  /** Whether kill server is in progress */
  killingServer?: boolean;
}

/**
 * AppSettingsModal provides UI for global app settings.
 */
export function AppSettingsModal({
  isOpen,
  onClose,
  onResetAll,
  resetting = false,
  onKillServer,
  killingServer = false,
}: AppSettingsModalProps) {
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showKillConfirm, setShowKillConfirm] = useState(false);
  const [serverKilled, setServerKilled] = useState(false);
  const [killError, setKillError] = useState(false);

  // Markdown rendering preference
  const { enabled: markdownEnabled, toggle: toggleMarkdown, saving: savingMarkdown } = useMarkdownPreference();

  // Log level preference
  const { level: logLevel, availableLevels, setLevel: setLogLevel, saving: savingLogLevel, isFromEnv: logLevelFromEnv } = useLogLevelPreference();

  // Reset state when modal closes
  function handleClose() {
    setShowResetConfirm(false);
    setShowKillConfirm(false);
    setServerKilled(false);
    setKillError(false);
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

        {/* Developer Settings */}
        <div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-4">
            Developer Settings
          </h3>
          <div className="space-y-3 p-4 rounded-lg bg-gray-50 dark:bg-gray-900">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <label
                  htmlFor="log-level"
                  className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1"
                >
                  Log Level
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  Controls the verbosity of logging for both frontend and backend.
                  Lower levels show more detailed information for debugging.
                </p>
                {logLevelFromEnv ? (
                  <div className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-md px-3 py-2">
                    Log level is controlled by the <code className="font-mono text-xs bg-amber-100 dark:bg-amber-800 px-1 py-0.5 rounded">RALPHER_LOG_LEVEL</code> environment variable.
                    Current level: <strong>{logLevel}</strong>
                  </div>
                ) : (
                  <select
                    id="log-level"
                    value={logLevel}
                    onChange={(e) => setLogLevel(e.target.value as LogLevelName)}
                    disabled={savingLogLevel}
                    className="block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50"
                  >
                    {availableLevels.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label} - {option.description}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Reset All Settings - Danger Zone */}
        {(onResetAll || onKillServer) && (
          <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
            <div className="p-4 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/20">
              <h3 className="text-sm font-medium text-red-800 dark:text-red-200 mb-4">
                Danger Zone
              </h3>
              
              {/* Reset All Settings */}
              {onResetAll && (
                <div className="mb-4">
                  <p className="text-sm text-red-600 dark:text-red-400 mb-3">
                    This will delete all loops, sessions, workspaces, and preferences. This action cannot be undone.
                  </p>
                  {!showResetConfirm ? (
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      onClick={() => setShowResetConfirm(true)}
                      disabled={resetting || killingServer}
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
              )}

              {/* Kill Server */}
              {onKillServer && (
                <div className={onResetAll ? "pt-4 border-t border-red-200 dark:border-red-800" : ""}>
                  <p className="text-sm text-red-600 dark:text-red-400 mb-3">
                    Terminate the server process. In containerized environments (k8s), this will restart the container.
                  </p>
                  {serverKilled ? (
                    <div className="text-sm text-red-600 dark:text-red-400 font-medium">
                      Server is shutting down... Connection will be lost.
                    </div>
                  ) : !showKillConfirm ? (
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        setKillError(false);
                        setShowKillConfirm(true);
                      }}
                      disabled={resetting || killingServer}
                    >
                      Kill server
                    </Button>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-red-600 dark:text-red-400">Are you sure?</span>
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          onClick={async () => {
                            if (onKillServer) {
                              setKillError(false);
                              const success = await onKillServer();
                              if (success) {
                                setServerKilled(true);
                                // Don't close the modal - let the user see the shutdown message
                              } else {
                                setKillError(true);
                              }
                            }
                          }}
                          loading={killingServer}
                        >
                          Yes, kill server
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setShowKillConfirm(false);
                            setKillError(false);
                          }}
                          disabled={killingServer}
                        >
                          Cancel
                        </Button>
                      </div>
                      {killError && (
                        <div className="text-sm text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30 rounded px-2 py-1">
                          Failed to kill server. Please try again.
                        </div>
                      )}
                    </div>
                  )}
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
