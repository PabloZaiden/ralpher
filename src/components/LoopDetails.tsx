/**
 * LoopDetails component showing full loop information with tabs.
 */

import { useEffect, useRef, useState } from "react";
import type { FileDiff, FileContentResponse } from "../types";
import { useLoop } from "../hooks";
import { Badge, Button, Card, getStatusBadgeVariant } from "./common";
import { LogViewer } from "./LogViewer";
import {
  AcceptLoopModal,
  DeleteLoopModal,
  PurgeLoopModal,
} from "./LoopModals";
import { PlanReviewPanel } from "./PlanReviewPanel";
import {
  getStatusLabel,
  canAccept,
  isFinalState,
  isLoopActive,
  isLoopRunning,
} from "../utils";

export interface LoopDetailsProps {
  /** Loop ID to display */
  loopId: string;
  /** Callback to go back to dashboard */
  onBack?: () => void;
}

type TabId = "log" | "prompt" | "plan" | "status" | "diff";

const tabs: { id: TabId; label: string }[] = [
  { id: "log", label: "Log" },
  { id: "prompt", label: "Prompt" },
  { id: "plan", label: "Plan" },
  { id: "status", label: "Status" },
  { id: "diff", label: "Diff" },
];

/**
 * Format a timestamp for display.
 */
function formatDateTime(isoString: string | undefined): string {
  if (!isoString) return "N/A";
  return new Date(isoString).toLocaleString();
}

/**
 * Render diff patch with syntax highlighting for additions/deletions.
 */
function DiffPatchViewer({ patch }: { patch: string }) {
  // Normalize line endings and split
  const lines = patch.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  
  return (
    <pre className="text-xs font-mono overflow-x-auto bg-gray-950 p-3 rounded-b">
      {lines.map((line, i) => {
        let className = "text-gray-400";
        if (line.startsWith("+") && !line.startsWith("+++")) {
          className = "text-green-400 bg-green-950/50";
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          className = "text-red-400 bg-red-950/50";
        } else if (line.startsWith("@@")) {
          className = "text-blue-400";
        } else if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) {
          className = "text-gray-500";
        }
        return (
          <div key={i} className={className}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

export function LoopDetails({ loopId, onBack }: LoopDetailsProps) {
  const {
    loop,
    loading,
    error,
    connectionStatus,
    messages,
    toolCalls,
    logs,
    gitChangeCounter,
    accept,
    push,
    remove,
    purge,
    setPendingPrompt,
    clearPendingPrompt,
    getDiff,
    getPlan,
    getStatusFile,
    sendPlanFeedback,
    acceptPlan,
    discardPlan,
  } = useLoop(loopId);

  const [activeTab, setActiveTab] = useState<TabId>("log");
  const [planContent, setPlanContent] = useState<FileContentResponse | null>(null);
  const [statusContent, setStatusContent] = useState<FileContentResponse | null>(null);
  const [diffContent, setDiffContent] = useState<FileDiff[]>([]);
  const [loadingContent, setLoadingContent] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  // Track which tabs have unseen updates
  const [tabsWithUpdates, setTabsWithUpdates] = useState<Set<TabId>>(new Set());
  
  // Track previous values to detect changes
  const prevMessagesCount = useRef(0);
  const prevToolCallsCount = useRef(0);
  const prevLogsCount = useRef(0);
  const prevPlanContent = useRef<string | null>(null);
  const prevStatusContent = useRef<string | null>(null);

  // Modals
  const [deleteModal, setDeleteModal] = useState(false);
  const [acceptModal, setAcceptModal] = useState(false);
  const [purgeModal, setPurgeModal] = useState(false);

  // Pending prompt editing state
  const [pendingPromptText, setPendingPromptText] = useState("");
  const [pendingPromptDirty, setPendingPromptDirty] = useState(false);
  const [pendingPromptSaving, setPendingPromptSaving] = useState(false);

  // Initialize pending prompt text from loop state when it changes
  useEffect(() => {
    if (loop?.state.pendingPrompt !== undefined) {
      setPendingPromptText(loop.state.pendingPrompt ?? "");
      setPendingPromptDirty(false);
    }
  }, [loop?.state.pendingPrompt]);

  // Clear update indicator when switching to a tab
  function handleTabChange(tabId: TabId) {
    setActiveTab(tabId);
    setTabsWithUpdates((prev) => {
      const next = new Set(prev);
      next.delete(tabId);
      return next;
    });
  }

  // Detect changes in log content (messages, toolCalls, logs)
  useEffect(() => {
    const totalLogItems = messages.length + toolCalls.length + logs.length;
    const prevTotal = prevMessagesCount.current + prevToolCallsCount.current + prevLogsCount.current;
    
    if (totalLogItems > prevTotal && activeTab !== "log") {
      setTabsWithUpdates((prev) => new Set(prev).add("log"));
    }
    
    prevMessagesCount.current = messages.length;
    prevToolCallsCount.current = toolCalls.length;
    prevLogsCount.current = logs.length;
  }, [messages.length, toolCalls.length, logs.length, activeTab]);

  // Detect changes in diff content by fetching when git events occur
  // Only show indicator if the diff actually changed
  const prevGitChangeCounter = useRef(0);
  const prevDiffFileCount = useRef(0);
  useEffect(() => {
    async function checkDiffChanges() {
      if (gitChangeCounter > prevGitChangeCounter.current) {
        // Fetch the latest diff
        const newDiff = await getDiff();
        
        // Check if file count changed (simple heuristic for new changes)
        if (newDiff.length > prevDiffFileCount.current && activeTab !== "diff") {
          setTabsWithUpdates((prev) => new Set(prev).add("diff"));
        }
        
        // Update the diff content so it's ready when user switches to tab
        setDiffContent(newDiff);
        prevDiffFileCount.current = newDiff.length;
      }
      prevGitChangeCounter.current = gitChangeCounter;
    }
    
    checkDiffChanges();
  }, [gitChangeCounter, activeTab, getDiff]);

  // Detect changes in plan content
  useEffect(() => {
    const currentContent = planContent?.content ?? null;
    if (currentContent !== null && currentContent !== prevPlanContent.current && activeTab !== "plan") {
      setTabsWithUpdates((prev) => new Set(prev).add("plan"));
    }
    prevPlanContent.current = currentContent;
  }, [planContent?.content, activeTab]);

  // Detect changes in status content
  useEffect(() => {
    const currentContent = statusContent?.content ?? null;
    if (currentContent !== null && currentContent !== prevStatusContent.current && activeTab !== "status") {
      setTabsWithUpdates((prev) => new Set(prev).add("status"));
    }
    prevStatusContent.current = currentContent;
  }, [statusContent?.content, activeTab]);

  // Load content when tab changes
  useEffect(() => {
    async function loadContent() {
      setLoadingContent(true);
      try {
        if (activeTab === "plan") {
          const content = await getPlan();
          setPlanContent(content);
        } else if (activeTab === "status") {
          const content = await getStatusFile();
          setStatusContent(content);
        } else if (activeTab === "diff") {
          const content = await getDiff();
          setDiffContent(content);
        }
      } finally {
        setLoadingContent(false);
      }
    }

    if (activeTab !== "log" && activeTab !== "prompt") {
      loadContent();
    }
  }, [activeTab, getPlan, getStatusFile, getDiff]);

  // Handle delete
  async function handleDelete() {
    const success = await remove();
    if (success) {
      onBack?.();
    }
    setDeleteModal(false);
  }

  // Handle accept
  async function handleAccept() {
    await accept();
    setAcceptModal(false);
  }

  // Handle push
  async function handlePush() {
    await push();
    setAcceptModal(false);
  }

  // Handle purge
  async function handlePurge() {
    const success = await purge();
    if (success) {
      onBack?.();
    }
    setPurgeModal(false);
  }

  // Handle pending prompt save
  async function handleSavePendingPrompt() {
    if (!pendingPromptText.trim()) {
      return;
    }
    setPendingPromptSaving(true);
    const success = await setPendingPrompt(pendingPromptText.trim());
    if (success) {
      setPendingPromptDirty(false);
    }
    setPendingPromptSaving(false);
  }

  // Handle pending prompt clear
  async function handleClearPendingPrompt() {
    setPendingPromptSaving(true);
    const success = await clearPendingPrompt();
    if (success) {
      setPendingPromptText("");
      setPendingPromptDirty(false);
    }
    setPendingPromptSaving(false);
  }

  if (loading && !loop) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  if (!loop) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
        <div className="w-full">
          <Button variant="ghost" onClick={onBack}>
            ← Back
          </Button>
          <div className="mt-8 text-center">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              Loop not found
            </h2>
            <p className="mt-2 text-gray-500 dark:text-gray-400">
              {error || "The requested loop does not exist."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { config, state } = loop;
  const isActive = isLoopActive(state.status);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="px-4 sm:px-6 lg:px-8 py-3 sm:py-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            <Button variant="ghost" size="sm" onClick={onBack} className="self-start">
              ← Back
            </Button>
            <div className="flex-1 min-w-0">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 truncate">
                  {config.name}
                </h1>
                <div className="flex items-center gap-2 sm:gap-3">
                  <Badge variant={getStatusBadgeVariant(state.status)} size="md">
                    {getStatusLabel(state.status)}
                  </Badge>
                  {isActive && (
                    <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500" />
                    </span>
                  )}
                </div>
              </div>
              <p className="mt-1 text-xs sm:text-sm text-gray-500 dark:text-gray-400 font-mono truncate">
                {config.directory}
              </p>
            </div>
            {/* WebSocket Status */}
            <div className="flex items-center gap-2 text-xs sm:text-sm self-start sm:self-auto">
              <span
                className={`h-2 w-2 rounded-full flex-shrink-0 ${
                  connectionStatus === "open"
                    ? "bg-green-500"
                    : connectionStatus === "connecting"
                    ? "bg-yellow-500"
                    : "bg-red-500"
                }`}
              />
              <span className="text-gray-500 dark:text-gray-400">
                {connectionStatus === "open" ? "Live" : connectionStatus === "connecting" ? "Connecting..." : "Disconnected"}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
        {/* Error display */}
        {error && (
          <div className="mb-6 rounded-md bg-red-50 dark:bg-red-900/20 p-4">
            <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6">
          {/* Left column - Stats and actions */}
          <div className="lg:col-span-1 space-y-4 sm:space-y-6">
            {/* Stats card */}
            <Card title="Statistics">
              <dl className="space-y-2 sm:space-y-3 text-xs sm:text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-500 dark:text-gray-400">Iteration</dt>
                  <dd className="font-medium text-gray-900 dark:text-gray-100">
                    {state.currentIteration}
                    {config.maxIterations ? ` / ${config.maxIterations}` : ""}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500 dark:text-gray-400">Started</dt>
                  <dd className="font-medium text-gray-900 dark:text-gray-100 text-right">
                    {formatDateTime(state.startedAt)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500 dark:text-gray-400">Last activity</dt>
                  <dd className="font-medium text-gray-900 dark:text-gray-100 text-right">
                    {formatDateTime(state.lastActivityAt)}
                  </dd>
                </div>
                {state.completedAt && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-gray-400">Completed</dt>
                    <dd className="font-medium text-gray-900 dark:text-gray-100 text-right">
                      {formatDateTime(state.completedAt)}
                    </dd>
                  </div>
                )}
              </dl>
            </Card>

            {/* Git info card */}
            {state.git && (
              <Card title="Git">
                <dl className="space-y-2 sm:space-y-3 text-xs sm:text-sm">
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">Original branch</dt>
                    <dd className="font-mono text-gray-900 dark:text-gray-100 break-all">
                      {state.git.originalBranch}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">Working branch</dt>
                    <dd className="font-mono text-gray-900 dark:text-gray-100 break-all">
                      {state.git.workingBranch}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">Commits</dt>
                    <dd className="font-medium text-gray-900 dark:text-gray-100">
                      {state.git.commits.length}
                    </dd>
                  </div>
                </dl>
              </Card>
            )}

            {/* Actions card */}
            <Card title="Actions">
              <div className="space-y-2">
                {/* Final state - only show Purge */}
                {isFinalState(state.status) ? (
                  <Button
                    className="w-full"
                    variant="danger"
                    onClick={() => setPurgeModal(true)}
                  >
                    Purge Loop
                  </Button>
                ) : (
                  <>
                    {canAccept(state.status) && state.git && (
                      <Button
                        className="w-full"
                        variant="primary"
                        onClick={() => setAcceptModal(true)}
                      >
                        Accept
                      </Button>
                    )}
                    <hr className="border-gray-200 dark:border-gray-700" />
                    <Button
                      className="w-full"
                      variant="danger"
                      onClick={() => setDeleteModal(true)}
                    >
                      Delete Loop
                    </Button>
                  </>
                )}
              </div>
            </Card>
          </div>

          {/* Right column - Tabs content */}
          <div className="lg:col-span-4 xl:col-span-5">
            {state.status === "planning" ? (
              <PlanReviewPanel
                loop={loop}
                planContent={planContent?.content ?? ""}
                onSendFeedback={async (feedback) => {
                  await sendPlanFeedback(feedback);
                }}
                onAcceptPlan={async () => {
                  await acceptPlan();
                }}
                onDiscardPlan={async () => {
                  await discardPlan();
                  if (onBack) onBack();
                }}
              />
            ) : (
              <>
                {/* Tab navigation */}
                <div className="flex border-b border-gray-200 dark:border-gray-700 mb-4 overflow-x-auto">
                  {tabs.map((tab) => {
                    const hasUpdate = tabsWithUpdates.has(tab.id);
                    return (
                      <button
                        key={tab.id}
                        onClick={() => handleTabChange(tab.id)}
                        className={`relative px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                          activeTab === tab.id
                            ? "border-blue-500 text-blue-600 dark:text-blue-400"
                            : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                        }`}
                      >
                        {tab.label}
                        {hasUpdate && activeTab !== tab.id && (
                          <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-blue-500" />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Tab content */}
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
                  {activeTab === "log" && (
                    <LogViewer
                      messages={messages}
                      toolCalls={toolCalls}
                      logs={logs}
                      maxHeight="600px"
                    />
                  )}

                  {activeTab === "prompt" && (
                    <div className="p-4 space-y-6">
                      {/* Original Task Prompt (read-only) */}
                      <div>
                        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                          Original Task Prompt
                        </h3>
                        <pre className="whitespace-pre-wrap text-sm text-gray-900 dark:text-gray-100 font-mono bg-gray-50 dark:bg-gray-900 rounded-md p-4">
                          {config.prompt || "No prompt specified."}
                        </pre>
                      </div>

                      {/* Pending Prompt Editor (only when running) */}
                      {isLoopRunning(state.status) && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                              Pending Prompt for Next Iteration
                              {state.pendingPrompt && (
                                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                                  Scheduled
                                </span>
                              )}
                            </h3>
                            {pendingPromptDirty && (
                              <span className="text-xs text-yellow-600 dark:text-yellow-400">
                                Unsaved changes
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                            Modify the prompt for the next iteration. The current iteration will continue with the original prompt.
                          </p>
                          <textarea
                            value={pendingPromptText}
                            onChange={(e) => {
                              setPendingPromptText(e.target.value);
                              setPendingPromptDirty(true);
                            }}
                            placeholder="Enter a modified prompt for the next iteration..."
                            rows={5}
                            className="w-full px-3 py-2 text-sm font-mono rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            disabled={pendingPromptSaving}
                          />
                          <div className="flex gap-2 mt-2">
                            <Button
                              size="sm"
                              onClick={handleSavePendingPrompt}
                              disabled={!pendingPromptText.trim() || pendingPromptSaving}
                            >
                              {pendingPromptSaving ? "Saving..." : state.pendingPrompt ? "Update Pending Prompt" : "Set Pending Prompt"}
                            </Button>
                            {state.pendingPrompt && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={handleClearPendingPrompt}
                                disabled={pendingPromptSaving}
                              >
                                Clear Pending Prompt
                              </Button>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Show existing pending prompt for non-running loops (read-only info) */}
                      {!isLoopRunning(state.status) && state.pendingPrompt && (
                        <div>
                          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                            Pending Prompt (Unused)
                            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
                              Not Applied
                            </span>
                          </h3>
                          <pre className="whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-400 font-mono bg-gray-50 dark:bg-gray-900 rounded-md p-4 border border-dashed border-gray-300 dark:border-gray-600">
                            {state.pendingPrompt}
                          </pre>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            This pending prompt was set but the loop is no longer running.
                          </p>
                        </div>
                      )}

                      {/* Info message when loop is not running and no pending prompt */}
                      {!isLoopRunning(state.status) && !state.pendingPrompt && (
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Pending prompts can only be set while the loop is running. Start the loop to modify the prompt for subsequent iterations.
                        </p>
                      )}
                    </div>
                  )}

                  {activeTab === "plan" && (
                    <div className="p-4">
                      {loadingContent ? (
                        <div className="flex justify-center py-8">
                          <div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-500 border-t-transparent" />
                        </div>
                      ) : planContent?.exists ? (
                        <pre className="whitespace-pre-wrap text-sm text-gray-900 dark:text-gray-100 font-mono">
                          {planContent.content}
                        </pre>
                      ) : (
                        <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                          No plan.md file found in the project directory.
                        </p>
                      )}
                    </div>
                  )}

                  {activeTab === "status" && (
                    <div className="p-4">
                      {loadingContent ? (
                        <div className="flex justify-center py-8">
                          <div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-500 border-t-transparent" />
                        </div>
                      ) : statusContent?.exists ? (
                        <pre className="whitespace-pre-wrap text-sm text-gray-900 dark:text-gray-100 font-mono">
                          {statusContent.content}
                        </pre>
                      ) : (
                        <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                          No status.md file found in the project directory.
                        </p>
                      )}
                    </div>
                  )}

                  {activeTab === "diff" && (
                    <div className="p-4">
                      {loadingContent ? (
                        <div className="flex justify-center py-8">
                          <div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-500 border-t-transparent" />
                        </div>
                      ) : diffContent.length > 0 ? (
                        <div className="space-y-2">
                          {diffContent.map((file) => {
                            const isExpanded = expandedFiles.has(file.path);
                            const hasPatch = !!file.patch;
                            
                            return (
                              <div
                                key={file.path}
                                className="bg-gray-50 dark:bg-gray-900 rounded text-xs sm:text-sm overflow-hidden"
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (hasPatch) {
                                      setExpandedFiles((prev) => {
                                        const next = new Set(prev);
                                        if (isExpanded) {
                                          next.delete(file.path);
                                        } else {
                                          next.add(file.path);
                                        }
                                        return next;
                                      });
                                    }
                                  }}
                                  className={`w-full flex items-center gap-2 sm:gap-3 p-2 text-left ${
                                    hasPatch ? "cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800" : "cursor-default"
                                  }`}
                                >
                                  {hasPatch && (
                                    <span className="text-gray-400 flex-shrink-0 text-sm">
                                      {isExpanded ? "▼" : "▶"}
                                    </span>
                                  )}
                                  <span
                                    className={`font-medium flex-shrink-0 ${
                                      file.status === "added"
                                        ? "text-green-600 dark:text-green-400"
                                        : file.status === "deleted"
                                        ? "text-red-600 dark:text-red-400"
                                        : file.status === "renamed"
                                        ? "text-purple-600 dark:text-purple-400"
                                        : "text-yellow-600 dark:text-yellow-400"
                                    }`}
                                  >
                                    {file.status === "added" && "+"}
                                    {file.status === "deleted" && "-"}
                                    {file.status === "renamed" && "→"}
                                    {file.status === "modified" && "~"}
                                  </span>
                                  <span className="font-mono text-gray-900 dark:text-gray-100 flex-1 truncate min-w-0">
                                    {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                                  </span>
                                  <span className="text-gray-500 dark:text-gray-400 flex-shrink-0 whitespace-nowrap">
                                    <span className="text-green-600 dark:text-green-400">+{file.additions}</span>
                                    {" "}
                                    <span className="text-red-600 dark:text-red-400">-{file.deletions}</span>
                                  </span>
                                </button>
                                {isExpanded && file.patch && (
                                  <DiffPatchViewer patch={file.patch} />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                          No changes yet.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </main>

      {/* Delete confirmation modal */}
      <DeleteLoopModal
        isOpen={deleteModal}
        onClose={() => setDeleteModal(false)}
        onDelete={handleDelete}
      />

      {/* Accept/Push modal */}
      <AcceptLoopModal
        isOpen={acceptModal}
        onClose={() => setAcceptModal(false)}
        onAccept={handleAccept}
        onPush={handlePush}
      />

      {/* Purge confirmation modal */}
      <PurgeLoopModal
        isOpen={purgeModal}
        onClose={() => setPurgeModal(false)}
        onPurge={handlePurge}
      />
    </div>
  );
}

export default LoopDetails;
