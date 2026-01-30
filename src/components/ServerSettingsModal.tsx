/**
 * ServerSettingsModal component for configuring global server settings.
 * Allows switching between spawn (local) and connect (remote) modes.
 */

import { useState, useEffect, type FormEvent } from "react";
import { Modal, Button, Badge } from "./common";
import type { ServerSettings, ConnectionStatus } from "../types/settings";
import { useMarkdownPreference } from "../hooks";

export interface ServerSettingsModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** Current server settings */
  settings: ServerSettings | null;
  /** Current connection status */
  status: ConnectionStatus | null;
  /** Callback to save settings */
  onSave: (settings: ServerSettings) => Promise<boolean>;
  /** Callback to test connection */
  onTest: (settings: ServerSettings) => Promise<{ success: boolean; error?: string }>;
  /** Callback to reset all settings */
  onResetAll?: () => Promise<boolean>;
  /** Whether saving is in progress */
  saving?: boolean;
  /** Whether testing is in progress */
  testing?: boolean;
  /** Whether resetting is in progress */
  resetting?: boolean;
  /** Whether remote-only mode is enabled (RALPHER_REMOTE_ONLY) */
  remoteOnly?: boolean;
}

/**
 * ServerSettingsModal provides UI for configuring server connection settings.
 */
export function ServerSettingsModal({
  isOpen,
  onClose,
  settings,
  status,
  onSave,
  onTest,
  onResetAll,
  saving = false,
  testing = false,
  resetting = false,
  remoteOnly = false,
}: ServerSettingsModalProps) {
  // Form state
  const [mode, setMode] = useState<"spawn" | "connect">("spawn");
  const [hostname, setHostname] = useState("localhost");
  const [port, setPort] = useState("4096");
  const [password, setPassword] = useState("");
  const [useHttps, setUseHttps] = useState(false);
  const [allowInsecure, setAllowInsecure] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Markdown rendering preference
  const { enabled: markdownEnabled, toggle: toggleMarkdown, saving: savingMarkdown } = useMarkdownPreference();

  // Initialize form from settings when modal opens
  useEffect(() => {
    if (isOpen && settings) {
      // If remote-only mode is enabled, force connect mode
      const initialMode = remoteOnly ? "connect" : settings.mode;
      setMode(initialMode);
      setHostname(settings.hostname ?? "localhost");
      setPort(String(settings.port ?? 4096));
      setPassword(settings.password ?? "");
      setUseHttps(settings.useHttps ?? false);
      setAllowInsecure(settings.allowInsecure ?? false);
      setTestResult(null);
    }
  }, [isOpen, settings, remoteOnly]);

  // Handle form submission
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const newSettings: ServerSettings = {
      mode,
      ...(mode === "connect" && {
        hostname: hostname.trim(),
        port: parseInt(port, 10) || 4096,
        password: password.trim() || undefined,
        useHttps,
        allowInsecure: useHttps ? allowInsecure : undefined,
      }),
    };

    const success = await onSave(newSettings);
    if (success) {
      onClose();
    }
  }

  // Handle test connection
  async function handleTest() {
    setTestResult(null);
    
    const testSettings: ServerSettings = {
      mode,
      ...(mode === "connect" && {
        hostname: hostname.trim(),
        port: parseInt(port, 10) || 4096,
        password: password.trim() || undefined,
        useHttps,
        allowInsecure: useHttps ? allowInsecure : undefined,
      }),
    };

    const result = await onTest(testSettings);
    setTestResult(result);
  }

  function handleModeChange(newMode: "spawn" | "connect") {
    setMode(newMode);
    setTestResult(null);
  }

  function handleHostnameChange(value: string) {
    setHostname(value);
    setTestResult(null);
  }

  function handlePortChange(value: string) {
    setPort(value);
    setTestResult(null);
  }

  function handlePasswordChange(value: string) {
    setPassword(value);
    setTestResult(null);
  }

  function handleUseHttpsChange(checked: boolean) {
    setUseHttps(checked);
    // Reset allowInsecure if HTTPS is disabled
    if (!checked) {
      setAllowInsecure(false);
    }
    setTestResult(null);
  }

  function handleAllowInsecureChange(checked: boolean) {
    setAllowInsecure(checked);
    setTestResult(null);
  }

  // Validation
  const isValid = mode === "spawn" || (hostname.trim().length > 0);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Server Settings"
      description="Configure how Ralpher connects to the OpenCode server"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="server-settings-form"
            loading={saving}
            disabled={!isValid}
          >
            Save Changes
          </Button>
        </>
      }
    >
      <form id="server-settings-form" onSubmit={handleSubmit} className="space-y-6">
        {/* Connection Status */}
        <div className="flex items-center gap-2 p-3 rounded-md bg-gray-50 dark:bg-gray-900">
          <span className="text-sm text-gray-600 dark:text-gray-400">Current Status:</span>
          {status?.connected ? (
            <Badge variant="success">Connected</Badge>
          ) : status?.error ? (
            <Badge variant="error">Error</Badge>
          ) : (
            <Badge variant="warning">Idle</Badge>
          )}
          {status?.error && (
            <span className="text-xs text-red-600 dark:text-red-400 truncate flex-1">
              {status.error}
            </span>
          )}
        </div>

        {/* Server Mode */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            Server Mode
          </label>
          <div className="space-y-3">
            {/* Spawn Mode */}
            <label
              className={`flex items-start gap-3 p-4 rounded-lg border transition-colors ${
                remoteOnly
                  ? "cursor-not-allowed opacity-60 border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900"
                  : mode === "spawn"
                    ? "cursor-pointer border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                    : "cursor-pointer border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
              }`}
            >
              <input
                type="radio"
                name="mode"
                value="spawn"
                checked={mode === "spawn"}
                onChange={() => handleModeChange("spawn")}
                disabled={remoteOnly}
                className="mt-1 h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
              />
              <div>
                <div className={`font-medium ${remoteOnly ? "text-gray-500 dark:text-gray-500" : "text-gray-900 dark:text-gray-100"}`}>
                  Spawn Local Server
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Automatically start a local OpenCode server on demand.
                  Best for local development.
                </div>
                {remoteOnly && (
                  <div className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                    Disabled by RALPHER_REMOTE_ONLY environment variable
                  </div>
                )}
              </div>
            </label>

            {/* Connect Mode */}
            <label
              className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                mode === "connect"
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                  : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
              }`}
            >
              <input
                type="radio"
                name="mode"
                value="connect"
                checked={mode === "connect"}
                onChange={() => handleModeChange("connect")}
                className="mt-1 h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div className="flex-1">
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  Connect to Existing Server
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Connect to a remote OpenCode server.
                  Use for production or shared environments.
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* Connection Settings (only shown in connect mode) */}
        {mode === "connect" && (
          <div className="space-y-4 p-4 rounded-lg bg-gray-50 dark:bg-gray-900">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <label
                  htmlFor="hostname"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Hostname
                </label>
                <input
                  type="text"
                  id="hostname"
                  value={hostname}
                  onChange={(e) => handleHostnameChange(e.target.value)}
                  placeholder="localhost or remote-server.example.com"
                  required
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
                />
              </div>
              <div className="w-full sm:w-28">
                <label
                  htmlFor="port"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Port
                </label>
                <input
                  type="number"
                  id="port"
                  value={port}
                  onChange={(e) => handlePortChange(e.target.value)}
                  min="1"
                  max="65535"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Password (optional)
              </label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => handlePasswordChange(e.target.value)}
                placeholder="Leave empty if no authentication required"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Authentication token for the OpenCode server
              </p>
            </div>

            {/* HTTPS Settings */}
            <div className="space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useHttps}
                  onChange={(e) => handleUseHttpsChange(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Use HTTPS
                  </span>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Connect using a secure HTTPS connection
                  </p>
                </div>
              </label>

              {useHttps && (
                <label className="flex items-center gap-3 cursor-pointer ml-7">
                  <input
                    type="checkbox"
                    checked={allowInsecure}
                    onChange={(e) => handleAllowInsecureChange(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Allow self-signed certificates
                    </span>
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Warning: Disables TLS certificate verification
                    </p>
                  </div>
                </label>
              )}
            </div>

            {/* Test Connection Button */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleTest}
                loading={testing}
                disabled={!hostname.trim()}
              >
                Test Connection
              </Button>
              
              {/* Test Result */}
              {testResult && (
                <div className="flex items-center gap-2">
                  {testResult.success ? (
                    <>
                      <CheckIcon className="w-5 h-5 text-green-500 flex-shrink-0" />
                      <span className="text-sm text-green-600 dark:text-green-400">
                        Connection successful
                      </span>
                    </>
                  ) : (
                    <>
                      <XIcon className="w-5 h-5 text-red-500 flex-shrink-0" />
                      <span className="text-sm text-red-600 dark:text-red-400 break-words">
                        {testResult.error ?? "Connection failed"}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Display Settings */}
        <div className="border-t border-gray-200 dark:border-gray-700 pt-6 mt-6">
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

        {/* Reset All Settings - Danger Zone */}
        {onResetAll && (
          <div className="border-t border-gray-200 dark:border-gray-700 pt-6 mt-6">
            <div className="p-4 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/20">
              <h3 className="text-sm font-medium text-red-800 dark:text-red-200 mb-2">
                Danger Zone
              </h3>
              <p className="text-sm text-red-600 dark:text-red-400 mb-4">
                This will delete all loops, sessions, and preferences. This action cannot be undone.
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
                      const success = await onResetAll();
                      if (success) {
                        setShowResetConfirm(false);
                        onClose();
                        // Reload the page to get fresh state
                        window.location.reload();
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
      </form>
    </Modal>
  );
}

/**
 * Simple check icon.
 */
function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

/**
 * Simple X icon.
 */
function XIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

export default ServerSettingsModal;
