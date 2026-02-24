/**
 * ServerSettingsForm component for configuring server connection settings.
 * This component is shared between CreateWorkspaceModal and WorkspaceSettingsModal.
 */

import { useState, useEffect } from "react";
import { Button } from "./common";
import type { ServerSettings, AgentProvider, AgentTransport, ExecutionProvider } from "../types/settings";

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

function parseArgs(argsText: string): string[] {
  return argsText
    .split(",")
    .map((arg) => arg.trim())
    .filter((arg) => arg.length > 0);
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
  const [agentProvider, setAgentProvider] = useState<AgentProvider>(
    initialSettings?.agent.provider ?? "opencode"
  );
  const [agentTransport, setAgentTransport] = useState<AgentTransport>(
    remoteOnly ? "tcp" : (initialSettings?.agent.transport ?? "stdio")
  );
  const [agentHostname, setAgentHostname] = useState(initialSettings?.agent.hostname ?? "localhost");
  const [agentPort, setAgentPort] = useState(String(initialSettings?.agent.port ?? 4096));
  const [agentPassword, setAgentPassword] = useState(initialSettings?.agent.password ?? "");
  const [agentUseHttps, setAgentUseHttps] = useState(initialSettings?.agent.useHttps ?? false);
  const [agentAllowInsecure, setAgentAllowInsecure] = useState(initialSettings?.agent.allowInsecure ?? false);
  const [agentCommand, setAgentCommand] = useState(initialSettings?.agent.command ?? "");
  const [agentArgs, setAgentArgs] = useState((initialSettings?.agent.args ?? []).join(", "));

  const [executionProvider, setExecutionProvider] = useState<ExecutionProvider>(
    remoteOnly ? "ssh" : (initialSettings?.execution.provider ?? "local")
  );
  const [executionHost, setExecutionHost] = useState(initialSettings?.execution.host ?? "localhost");
  const [executionPort, setExecutionPort] = useState(String(initialSettings?.execution.port ?? 22));
  const [executionUser, setExecutionUser] = useState(initialSettings?.execution.user ?? "");
  const [executionWorkspaceRoot, setExecutionWorkspaceRoot] = useState(
    initialSettings?.execution.workspaceRoot ?? (remoteOnly ? "/workspaces" : "")
  );

  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const nextAgentProvider = initialSettings?.agent.provider ?? "opencode";
    const nextAgentTransport = remoteOnly ? "tcp" : (initialSettings?.agent.transport ?? "stdio");
    const nextAgentHostname = initialSettings?.agent.hostname ?? "localhost";
    const nextAgentPort = String(initialSettings?.agent.port ?? 4096);
    const nextAgentPassword = initialSettings?.agent.password ?? "";
    const nextAgentUseHttps = initialSettings?.agent.useHttps ?? false;
    const nextAgentAllowInsecure = initialSettings?.agent.allowInsecure ?? false;
    const nextAgentCommand = initialSettings?.agent.command ?? "";
    const nextAgentArgs = initialSettings?.agent.args ?? [];

    const nextExecutionProvider = remoteOnly ? "ssh" : (initialSettings?.execution.provider ?? "local");
    const nextExecutionHost = initialSettings?.execution.host ?? "localhost";
    const nextExecutionPort = String(initialSettings?.execution.port ?? 22);
    const nextExecutionUser = initialSettings?.execution.user ?? "";
    const nextExecutionWorkspaceRoot = initialSettings?.execution.workspaceRoot ?? (remoteOnly ? "/workspaces" : "");

    setAgentProvider(nextAgentProvider);
    setAgentTransport(nextAgentTransport);
    setAgentHostname(nextAgentHostname);
    setAgentPort(nextAgentPort);
    setAgentPassword(nextAgentPassword);
    setAgentUseHttps(nextAgentUseHttps);
    setAgentAllowInsecure(nextAgentAllowInsecure);
    setAgentCommand(nextAgentCommand);
    setAgentArgs(nextAgentArgs.join(", "));

    setExecutionProvider(nextExecutionProvider);
    setExecutionHost(nextExecutionHost);
    setExecutionPort(nextExecutionPort);
    setExecutionUser(nextExecutionUser);
    setExecutionWorkspaceRoot(nextExecutionWorkspaceRoot);

    setTestResult(null);
    setShowPassword(false);

    const remoteAgent = isRemoteAgentTransport(nextAgentTransport);
    const nextSettings: ServerSettings = {
      agent: {
        provider: nextAgentProvider,
        transport: nextAgentTransport,
        useHttps: remoteAgent ? nextAgentUseHttps : false,
        allowInsecure: remoteAgent && nextAgentUseHttps ? nextAgentAllowInsecure : false,
        ...(remoteAgent && {
          hostname: nextAgentHostname.trim(),
          port: parseInt(nextAgentPort, 10) || 4096,
          password: nextAgentPassword.trim() || undefined,
        }),
        ...(nextAgentCommand.trim() && { command: nextAgentCommand.trim() }),
        ...(nextAgentArgs.length > 0 && { args: nextAgentArgs }),
      },
      execution: {
        provider: nextExecutionProvider,
        ...(nextExecutionProvider === "ssh" && {
          host: nextExecutionHost.trim(),
          port: parseInt(nextExecutionPort, 10) || 22,
          user: nextExecutionUser.trim(),
          workspaceRoot: nextExecutionWorkspaceRoot.trim() || undefined,
        }),
        ...(nextExecutionProvider === "local" && nextExecutionWorkspaceRoot.trim() && {
          workspaceRoot: nextExecutionWorkspaceRoot.trim(),
        }),
      },
    };
    const agentValid = !remoteAgent || nextAgentHostname.trim().length > 0;
    const executionValid =
      nextExecutionProvider === "local" ||
      (nextExecutionHost.trim().length > 0 && nextExecutionUser.trim().length > 0);
    onChange(nextSettings, agentValid && executionValid);
  }, [initialSettings, remoteOnly]);

  function isRemoteAgentTransport(transport: AgentTransport): boolean {
    return transport === "tcp" || transport === "ssh-stdio";
  }

  function buildSettings(overrides?: {
    agentProvider?: AgentProvider;
    agentTransport?: AgentTransport;
    agentHostname?: string;
    agentPort?: string;
    agentPassword?: string;
    agentUseHttps?: boolean;
    agentAllowInsecure?: boolean;
    agentCommand?: string;
    agentArgs?: string;
    executionProvider?: ExecutionProvider;
    executionHost?: string;
    executionPort?: string;
    executionUser?: string;
    executionWorkspaceRoot?: string;
  }): ServerSettings {
    const currentAgentProvider = overrides?.agentProvider ?? agentProvider;
    const currentAgentTransport = overrides?.agentTransport ?? agentTransport;
    const currentAgentHostname = overrides?.agentHostname ?? agentHostname;
    const currentAgentPort = overrides?.agentPort ?? agentPort;
    const currentAgentPassword = overrides?.agentPassword ?? agentPassword;
    const currentAgentUseHttps = overrides?.agentUseHttps ?? agentUseHttps;
    const currentAgentAllowInsecure = overrides?.agentAllowInsecure ?? agentAllowInsecure;
    const currentAgentCommand = overrides?.agentCommand ?? agentCommand;
    const currentAgentArgs = overrides?.agentArgs ?? agentArgs;

    const currentExecutionProvider = overrides?.executionProvider ?? executionProvider;
    const currentExecutionHost = overrides?.executionHost ?? executionHost;
    const currentExecutionPort = overrides?.executionPort ?? executionPort;
    const currentExecutionUser = overrides?.executionUser ?? executionUser;
    const currentExecutionWorkspaceRoot = overrides?.executionWorkspaceRoot ?? executionWorkspaceRoot;

    const remoteAgent = isRemoteAgentTransport(currentAgentTransport);

    return {
      agent: {
        provider: currentAgentProvider,
        transport: currentAgentTransport,
        useHttps: remoteAgent ? currentAgentUseHttps : false,
        allowInsecure: remoteAgent && currentAgentUseHttps ? currentAgentAllowInsecure : false,
        ...(remoteAgent && {
          hostname: currentAgentHostname.trim(),
          port: parseInt(currentAgentPort, 10) || 4096,
          password: currentAgentPassword.trim() || undefined,
        }),
        ...(currentAgentCommand.trim() && { command: currentAgentCommand.trim() }),
        ...(parseArgs(currentAgentArgs).length > 0 && { args: parseArgs(currentAgentArgs) }),
      },
      execution: {
        provider: currentExecutionProvider,
        ...(currentExecutionProvider === "ssh" && {
          host: currentExecutionHost.trim(),
          port: parseInt(currentExecutionPort, 10) || 22,
          user: currentExecutionUser.trim(),
          workspaceRoot: currentExecutionWorkspaceRoot.trim() || undefined,
        }),
        ...(currentExecutionProvider === "local" && currentExecutionWorkspaceRoot.trim() && {
          workspaceRoot: currentExecutionWorkspaceRoot.trim(),
        }),
      },
    };
  }

  function notifyChange(overrides?: {
    agentProvider?: AgentProvider;
    agentTransport?: AgentTransport;
    agentHostname?: string;
    executionProvider?: ExecutionProvider;
    executionHost?: string;
    executionUser?: string;
  }) {
    const currentAgentTransport = overrides?.agentTransport ?? agentTransport;
    const currentAgentHostname = overrides?.agentHostname ?? agentHostname;
    const currentExecutionProvider = overrides?.executionProvider ?? executionProvider;
    const currentExecutionHost = overrides?.executionHost ?? executionHost;
    const currentExecutionUser = overrides?.executionUser ?? executionUser;

    const remoteAgent = isRemoteAgentTransport(currentAgentTransport);
    const agentValid = !remoteAgent || currentAgentHostname.trim().length > 0;
    const executionValid =
      currentExecutionProvider === "local" ||
      (currentExecutionHost.trim().length > 0 && currentExecutionUser.trim().length > 0);

    const isValid = agentValid && executionValid;
    onChange(buildSettings(overrides), isValid);
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
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Agent Channel</h3>

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
                notifyChange({ agentProvider: value });
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
                if (value === "stdio") {
                  setAgentUseHttps(false);
                  setAgentAllowInsecure(false);
                }
                setTestResult(null);
                notifyChange({ agentTransport: value });
              }}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            >
              <option value="stdio" disabled={remoteOnly}>stdio (local process)</option>
              <option value="tcp">tcp</option>
              <option value="ssh-stdio">ssh-stdio</option>
            </select>
          </div>
        </div>

        {isRemoteAgentTransport(agentTransport) && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Hostname</label>
                <input
                  type="text"
                  value={agentHostname}
                  onChange={(e) => {
                    setAgentHostname(e.target.value);
                    setTestResult(null);
                    notifyChange({ agentHostname: e.target.value });
                  }}
                  placeholder="localhost"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Port</label>
                <input
                  type="number"
                  value={agentPort}
                  onChange={(e) => {
                    setAgentPort(e.target.value);
                    setTestResult(null);
                    notifyChange();
                  }}
                  min="1"
                  max="65535"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password (optional)</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={agentPassword}
                  onChange={(e) => {
                    setAgentPassword(e.target.value);
                    setTestResult(null);
                    notifyChange();
                  }}
                  placeholder="Authentication token"
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

            <div className="space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agentUseHttps}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setAgentUseHttps(checked);
                    if (!checked) {
                      setAgentAllowInsecure(false);
                    }
                    setTestResult(null);
                    notifyChange();
                  }}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Use HTTPS</span>
              </label>

              {agentUseHttps && (
                <label className="flex items-center gap-3 cursor-pointer ml-7">
                  <input
                    type="checkbox"
                    checked={agentAllowInsecure}
                    onChange={(e) => {
                      setAgentAllowInsecure(e.target.checked);
                      setTestResult(null);
                      notifyChange();
                    }}
                    className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Allow self-signed certificates</span>
                </label>
              )}
            </div>
          </>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Command (optional)
            </label>
            <input
              type="text"
              value={agentCommand}
              onChange={(e) => {
                setAgentCommand(e.target.value);
                setTestResult(null);
                notifyChange();
              }}
              placeholder="copilot"
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Args (optional, comma-separated)
            </label>
            <input
              type="text"
              value={agentArgs}
              onChange={(e) => {
                setAgentArgs(e.target.value);
                setTestResult(null);
                notifyChange();
              }}
              placeholder="acp, --stdio"
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
          </div>
        </div>
      </div>

      <div className="space-y-4 p-4 rounded-lg bg-gray-50 dark:bg-gray-900">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Execution Channel</h3>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Provider</label>
          <select
            value={executionProvider}
            onChange={(e) => {
              const value = e.target.value as ExecutionProvider;
              setExecutionProvider(value);
              setTestResult(null);
              notifyChange({ executionProvider: value });
            }}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          >
            <option value="local" disabled={remoteOnly}>local</option>
            <option value="ssh">ssh</option>
          </select>
        </div>

        {executionProvider === "ssh" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Host</label>
              <input
                type="text"
                value={executionHost}
                onChange={(e) => {
                  setExecutionHost(e.target.value);
                  setTestResult(null);
                  notifyChange({ executionHost: e.target.value });
                }}
                placeholder="remote-host"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Port</label>
              <input
                type="number"
                value={executionPort}
                onChange={(e) => {
                  setExecutionPort(e.target.value);
                  setTestResult(null);
                  notifyChange();
                }}
                min="1"
                max="65535"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">User</label>
              <input
                type="text"
                value={executionUser}
                onChange={(e) => {
                  setExecutionUser(e.target.value);
                  setTestResult(null);
                  notifyChange({ executionUser: e.target.value });
                }}
                placeholder="vscode"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Workspace Root (optional)</label>
              <input
                type="text"
                value={executionWorkspaceRoot}
                onChange={(e) => {
                  setExecutionWorkspaceRoot(e.target.value);
                  setTestResult(null);
                  notifyChange();
                }}
                placeholder="/workspaces"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Workspace Root (optional)</label>
            <input
              type="text"
              value={executionWorkspaceRoot}
              onChange={(e) => {
                setExecutionWorkspaceRoot(e.target.value);
                setTestResult(null);
                notifyChange();
              }}
              placeholder="/workspaces"
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
          </div>
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
