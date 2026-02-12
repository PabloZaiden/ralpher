/**
 * ServerSettingsForm component for configuring server connection settings.
 * This component is shared between CreateWorkspaceModal and WorkspaceSettingsModal.
 */

import { useState, useEffect } from "react";
import { Button } from "./common";
import type { ServerSettings } from "../types/settings";

export interface ServerSettingsFormProps {
  /** Initial server settings (for editing) */
  initialSettings?: ServerSettings;
  /** Callback when settings change */
  onChange: (settings: ServerSettings, isValid: boolean) => void;
  /** Callback to test connection - if not provided, test button is hidden */
  onTest?: (settings: ServerSettings) => Promise<{ success: boolean; error?: string }>;
  /** Whether testing is in progress */
  testing?: boolean;
  /** Whether remote-only mode is enabled (RALPHER_REMOTE_ONLY) */
  remoteOnly?: boolean;
}

/**
 * ServerSettingsForm provides UI for configuring server connection settings.
 * Used by both CreateWorkspaceModal and WorkspaceSettingsModal.
 */
export function ServerSettingsForm({
  initialSettings,
  onChange,
  onTest,
  testing = false,
  remoteOnly = false,
}: ServerSettingsFormProps) {
  // Server settings form state
  const [mode, setMode] = useState<"spawn" | "connect">(
    remoteOnly ? "connect" : initialSettings?.mode ?? "spawn"
  );
  const [hostname, setHostname] = useState(initialSettings?.hostname ?? "localhost");
  const [port, setPort] = useState(String(initialSettings?.port ?? 4096));
  const [password, setPassword] = useState(initialSettings?.password ?? "");
  const [useHttps, setUseHttps] = useState(initialSettings?.useHttps ?? false);
  const [allowInsecure, setAllowInsecure] = useState(initialSettings?.allowInsecure ?? false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Reset form when initialSettings or remoteOnly changes
  useEffect(() => {
    const initialMode = remoteOnly ? "connect" : initialSettings?.mode ?? "spawn";
    setMode(initialMode);
    setHostname(initialSettings?.hostname ?? "localhost");
    setPort(String(initialSettings?.port ?? 4096));
    setPassword(initialSettings?.password ?? "");
    setUseHttps(initialSettings?.useHttps ?? false);
    setAllowInsecure(initialSettings?.allowInsecure ?? false);
    setTestResult(null);
    setShowPassword(false);
  }, [initialSettings, remoteOnly]);

  // Build current settings with optional overrides for values being changed
  function buildSettings(overrides?: {
    newMode?: "spawn" | "connect";
    newHostname?: string;
    newPort?: string;
    newPassword?: string;
    newUseHttps?: boolean;
    newAllowInsecure?: boolean;
  }): ServerSettings {
    const currentMode = overrides?.newMode ?? mode;
    const currentHostname = overrides?.newHostname ?? hostname;
    const currentPort = overrides?.newPort ?? port;
    const currentPassword = overrides?.newPassword ?? password;
    const currentUseHttps = overrides?.newUseHttps ?? useHttps;
    const currentAllowInsecure = overrides?.newAllowInsecure ?? allowInsecure;

    return {
      mode: currentMode,
      useHttps: currentMode === "connect" ? currentUseHttps : false,
      allowInsecure: currentMode === "connect" && currentUseHttps ? currentAllowInsecure : false,
      ...(currentMode === "connect" && {
        hostname: currentHostname.trim(),
        port: parseInt(currentPort, 10) || 4096,
        password: currentPassword.trim() || undefined,
      }),
    };
  }

  // Notify parent of changes with optional overrides
  function notifyChange(overrides?: {
    newMode?: "spawn" | "connect";
    newHostname?: string;
    newPort?: string;
    newPassword?: string;
    newUseHttps?: boolean;
    newAllowInsecure?: boolean;
  }) {
    const currentMode = overrides?.newMode ?? mode;
    const currentHostname = overrides?.newHostname ?? hostname;
    const isValid = currentMode === "spawn" || currentHostname.trim().length > 0;
    const settings = buildSettings(overrides);
    onChange(settings, isValid);
  }

  // Handle test connection
  async function handleTest() {
    if (!onTest) return;
    
    setTestResult(null);
    const settings = buildSettings();
    const result = await onTest(settings);
    setTestResult(result);
  }

  function handleModeChange(newMode: "spawn" | "connect") {
    setMode(newMode);
    setTestResult(null);
    notifyChange({ newMode });
  }

  function handleHostnameChange(value: string) {
    setHostname(value);
    setTestResult(null);
    notifyChange({ newHostname: value });
  }

  function handlePortChange(value: string) {
    setPort(value);
    setTestResult(null);
    notifyChange({ newPort: value });
  }

  function handlePasswordChange(value: string) {
    setPassword(value);
    setTestResult(null);
    notifyChange({ newPassword: value });
  }

  function handleUseHttpsChange(checked: boolean) {
    setUseHttps(checked);
    // Reset allowInsecure if HTTPS is disabled
    if (!checked) {
      setAllowInsecure(false);
    }
    setTestResult(null);
    // When disabling HTTPS, also reset allowInsecure in the notification
    notifyChange({ newUseHttps: checked, newAllowInsecure: checked ? allowInsecure : false });
  }

  function handleAllowInsecureChange(checked: boolean) {
    setAllowInsecure(checked);
    setTestResult(null);
    notifyChange({ newAllowInsecure: checked });
  }

  return (
    <div className="space-y-4">
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
              name="server-mode"
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
              name="server-mode"
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
                htmlFor="server-hostname"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Hostname
              </label>
              <input
                type="text"
                id="server-hostname"
                value={hostname}
                onChange={(e) => handleHostnameChange(e.target.value)}
                placeholder="localhost or remote-server.example.com"
                required
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
              />
            </div>
            <div className="w-full sm:w-28">
              <label
                htmlFor="server-port"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Port
              </label>
              <input
                type="number"
                id="server-port"
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
              htmlFor="server-password"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Password (optional)
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                id="server-password"
                value={password}
                onChange={(e) => handlePasswordChange(e.target.value)}
                placeholder="Leave empty if no authentication required"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 pr-10 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
              >
                {showPassword ? (
                  <EyeOffIcon className="h-4 w-4" />
                ) : (
                  <EyeIcon className="h-4 w-4" />
                )}
              </button>
            </div>
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
          {onTest && (
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
          )}
        </div>
      )}
    </div>
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

/**
 * Eye icon for showing password.
 */
function EyeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

/**
 * Eye-off icon for hiding password.
 */
function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
    </svg>
  );
}

export default ServerSettingsForm;
