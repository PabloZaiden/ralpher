/**
 * ServerSettingsForm component for configuring workspace connection settings.
 * This component is shared between CreateWorkspaceModal and WorkspaceSettingsModal.
 */

import { useEffect, useState } from "react";
import { Button } from "./common";
import type { ServerSettings, AgentProvider, AgentTransport } from "../types/settings";

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
 * ServerSettingsForm provides UI for configuring connection settings.
 */
export function ServerSettingsForm({
  initialSettings,
  onChange,
  onTest,
  testing = false,
  remoteOnly = false,
}: ServerSettingsFormProps) {
  const [agentProvider, setAgentProvider] = useState<AgentProvider>(
    initialSettings?.agent.provider ?? "opencode",
  );
  const [agentTransport, setAgentTransport] = useState<AgentTransport>(
    remoteOnly ? "ssh" : (initialSettings?.agent.transport ?? "stdio"),
  );
  const [agentHostname, setAgentHostname] = useState(
    initialSettings?.agent.transport === "ssh" ? initialSettings.agent.hostname : "localhost",
  );
  const [agentPort, setAgentPort] = useState(
    String(initialSettings?.agent.transport === "ssh" ? (initialSettings.agent.port ?? 22) : 22),
  );
  const [agentUsername, setAgentUsername] = useState(
    initialSettings?.agent.transport === "ssh" ? (initialSettings.agent.username ?? "") : "",
  );
  const [agentPassword, setAgentPassword] = useState(
    initialSettings?.agent.transport === "ssh" ? (initialSettings.agent.password ?? "") : "",
  );

  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const nextProvider = initialSettings?.agent.provider ?? "opencode";
    const nextTransport = remoteOnly ? "ssh" : (initialSettings?.agent.transport ?? "stdio");
    const nextHost = initialSettings?.agent.transport === "ssh" ? initialSettings.agent.hostname : "localhost";
    const nextPort = String(initialSettings?.agent.transport === "ssh" ? (initialSettings.agent.port ?? 22) : 22);
    const nextUsername = initialSettings?.agent.transport === "ssh" ? (initialSettings.agent.username ?? "") : "";
    const nextPassword = initialSettings?.agent.transport === "ssh" ? (initialSettings.agent.password ?? "") : "";

    setAgentProvider(nextProvider);
    setAgentTransport(nextTransport);
    setAgentHostname(nextHost);
    setAgentPort(nextPort);
    setAgentUsername(nextUsername);
    setAgentPassword(nextPassword);
    setTestResult(null);
    setShowPassword(false);

    const settings = buildSettings({
      provider: nextProvider,
      transport: nextTransport,
      hostname: nextHost,
      port: nextPort,
      username: nextUsername,
      password: nextPassword,
    });
    onChange(settings, validateSettings(settings));
  }, [initialSettings, remoteOnly]);

  function buildSettings(overrides?: {
    provider?: AgentProvider;
    transport?: AgentTransport;
    hostname?: string;
    port?: string;
    username?: string;
    password?: string;
  }): ServerSettings {
    const provider = overrides?.provider ?? agentProvider;
    const transport = overrides?.transport ?? agentTransport;
    const hostname = overrides?.hostname ?? agentHostname;
    const port = overrides?.port ?? agentPort;
    const username = overrides?.username ?? agentUsername;
    const password = overrides?.password ?? agentPassword;

    if (transport === "ssh") {
      return {
        agent: {
          provider,
          transport,
          hostname: hostname.trim(),
          port: parseInt(port, 10) || 22,
          username: username.trim() || undefined,
          password: password.trim() || undefined,
        },
      };
    }

    return {
      agent: {
        provider,
        transport,
      },
    };
  }

  function validateSettings(settings: ServerSettings): boolean {
    if (settings.agent.transport === "ssh") {
      return settings.agent.hostname.trim().length > 0;
    }
    return true;
  }

  function notifyChange(overrides?: {
    provider?: AgentProvider;
    transport?: AgentTransport;
    hostname?: string;
    port?: string;
    username?: string;
    password?: string;
  }) {
    const settings = buildSettings(overrides);
    onChange(settings, validateSettings(settings));
  }

  async function handleTest() {
    if (!onTest) {
      return;
    }

    setTestResult(null);
    const result = await onTest(buildSettings());
    setTestResult(result);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4 p-4 rounded-lg bg-gray-50 dark:bg-gray-900">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Connection</h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Provider
            </label>
            <select
              value={agentProvider}
              onChange={(e) => {
                const value = e.target.value as AgentProvider;
                setAgentProvider(value);
                setTestResult(null);
                notifyChange({ provider: value });
              }}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            >
              <option value="opencode">OpenCode</option>
              <option value="copilot">Copilot</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Transport
            </label>
            <select
              value={agentTransport}
              onChange={(e) => {
                const value = e.target.value as AgentTransport;
                setAgentTransport(value);
                setTestResult(null);
                notifyChange({ transport: value });
              }}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            >
              <option value="stdio" disabled={remoteOnly}>stdio (local process)</option>
              <option value="ssh">ssh</option>
            </select>
          </div>
        </div>

        {agentTransport === "ssh" && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Hostname
                </label>
                <input
                  type="text"
                  value={agentHostname}
                  onChange={(e) => {
                    setAgentHostname(e.target.value);
                    setTestResult(null);
                    notifyChange({ hostname: e.target.value });
                  }}
                  placeholder="remote-host"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Port
                </label>
                <input
                  type="number"
                  value={agentPort}
                  onChange={(e) => {
                    setAgentPort(e.target.value);
                    setTestResult(null);
                    notifyChange({ port: e.target.value });
                  }}
                  min="1"
                  max="65535"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Username (optional)
                </label>
                <input
                  type="text"
                  value={agentUsername}
                  onChange={(e) => {
                    setAgentUsername(e.target.value);
                    setTestResult(null);
                    notifyChange({ username: e.target.value });
                  }}
                  placeholder="vscode"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Password (optional)
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={agentPassword}
                    onChange={(e) => {
                      setAgentPassword(e.target.value);
                      setTestResult(null);
                      notifyChange({ password: e.target.value });
                    }}
                    placeholder="SSH password"
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 pr-10 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                  >
                    {showPassword ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {onTest && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleTest}
            loading={testing}
          >
            Test Connection
          </Button>

          {testResult && (
            <div className="flex items-center gap-2">
              {testResult.success ? (
                <>
                  <CheckIcon className="w-5 h-5 text-green-500 flex-shrink-0" />
                  <span className="text-sm text-green-600 dark:text-green-400">Connection successful</span>
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
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
    </svg>
  );
}

export default ServerSettingsForm;

