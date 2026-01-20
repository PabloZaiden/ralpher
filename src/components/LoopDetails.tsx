/**
 * LoopDetails component showing full loop information with tabs.
 */

import { useEffect, useRef, useState } from "react";
import type { LoopStatus, FileDiff, FileContentResponse, UncommittedChangesError } from "../types";
import { useLoop } from "../hooks";
import { Badge, Button, Card, ConfirmModal, Modal, getStatusBadgeVariant } from "./common";
import { LogViewer } from "./LogViewer";

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
 * Get status label.
 */
function getStatusLabel(status: LoopStatus): string {
  switch (status) {
    case "idle":
      return "Idle";
    case "starting":
      return "Starting";
    case "running":
      return "Running";
    case "waiting":
      return "Waiting";
    case "paused":
      return "Paused";
    case "completed":
      return "Completed";
    case "stopped":
      return "Stopped";
    case "failed":
      return "Failed";
    case "max_iterations":
      return "Max Iterations";
    default:
      return status;
  }
}

/**
 * Render diff patch with syntax highlighting for additions/deletions.
 */
function DiffPatchViewer({ patch }: { patch: string }) {
  const lines = patch.split("\n");
  
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

/**
 * Check if loop can be started.
 * Only show start for idle or stopped loops, not for completed/failed ones.
 */
function canStart(status: LoopStatus): boolean {
  return ["idle", "stopped"].includes(status);
}

/**
 * Check if loop can be stopped.
 */
function canStop(status: LoopStatus): boolean {
  return ["running", "waiting", "starting", "paused"].includes(status);
}

/**
 * Check if loop can be paused.
 */
function canPause(status: LoopStatus): boolean {
  return ["running", "waiting"].includes(status);
}

/**
 * Check if loop can be resumed.
 */
function canResume(status: LoopStatus): boolean {
  return status === "paused";
}

/**
 * Check if loop can be accepted or discarded.
 */
function canAcceptOrDiscard(status: LoopStatus): boolean {
  return ["completed", "stopped", "failed", "max_iterations"].includes(status);
}

export function LoopDetails({ loopId, onBack }: LoopDetailsProps) {
  const {
    loop,
    loading,
    error,
    sseStatus,
    messages,
    toolCalls,
    progressContent,
    logs,
    gitChangeCounter,
    refresh,
    start,
    stop,
    pause,
    resume,
    accept,
    discard,
    remove,
    getDiff,
    getPlan,
    getStatusFile,
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
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [uncommittedModal, setUncommittedModal] = useState<{
    open: boolean;
    error: UncommittedChangesError | null;
  }>({ open: false, error: null });
  const [actionLoading, setActionLoading] = useState(false);

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

  // Detect changes in diff content based on git change events and tool calls
  // gitChangeCounter increments when iteration ends or git commit happens
  // toolCalls changes often mean file operations that affect the diff
  const prevGitChangeCounter = useRef(0);
  const prevToolCallsForDiff = useRef(0);
  useEffect(() => {
    const hasGitChange = gitChangeCounter > prevGitChangeCounter.current;
    const hasToolChange = toolCalls.length > prevToolCallsForDiff.current;
    
    if ((hasGitChange || hasToolChange) && activeTab !== "diff") {
      setTabsWithUpdates((prev) => new Set(prev).add("diff"));
    }
    
    prevGitChangeCounter.current = gitChangeCounter;
    prevToolCallsForDiff.current = toolCalls.length;
  }, [gitChangeCounter, toolCalls.length, activeTab]);

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

  // Handle start
  async function handleStart() {
    setActionLoading(true);
    const result = await start();
    if (result.uncommittedError) {
      setUncommittedModal({ open: true, error: result.uncommittedError });
    }
    setActionLoading(false);
  }

  // Handle uncommitted decision
  async function handleUncommittedDecision(action: "commit" | "stash") {
    setActionLoading(true);
    await start({ handleUncommitted: action });
    setUncommittedModal({ open: false, error: null });
    setActionLoading(false);
  }

  // Handle delete
  async function handleDelete() {
    setActionLoading(true);
    const success = await remove();
    if (success) {
      onBack?.();
    }
    setActionLoading(false);
    setDeleteConfirm(false);
  }

  // Handle accept
  async function handleAccept() {
    setActionLoading(true);
    await accept();
    setActionLoading(false);
  }

  // Handle discard
  async function handleDiscard() {
    setActionLoading(true);
    await discard();
    setActionLoading(false);
    setDiscardConfirm(false);
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
  const isActive = ["running", "waiting", "starting", "paused"].includes(state.status);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={onBack}>
              ← Back
            </Button>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {config.name}
                </h1>
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
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 font-mono">
                {config.directory}
              </p>
            </div>
            {/* SSE Status */}
            <div className="flex items-center gap-2 text-sm">
              <span
                className={`h-2 w-2 rounded-full ${
                  sseStatus === "open"
                    ? "bg-green-500"
                    : sseStatus === "connecting"
                    ? "bg-yellow-500"
                    : "bg-red-500"
                }`}
              />
              <span className="text-gray-500 dark:text-gray-400">
                {sseStatus === "open" ? "Live" : sseStatus === "connecting" ? "Connecting..." : "Disconnected"}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="px-4 sm:px-6 lg:px-8 py-6">
        {/* Error display */}
        {error && (
          <div className="mb-6 rounded-md bg-red-50 dark:bg-red-900/20 p-4">
            <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 xl:grid-cols-6 gap-6">
          {/* Left column - Stats and actions */}
          <div className="lg:col-span-1 space-y-6">
            {/* Stats card */}
            <Card title="Statistics">
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-500 dark:text-gray-400">Iteration</dt>
                  <dd className="font-medium text-gray-900 dark:text-gray-100">
                    {state.currentIteration}
                    {config.maxIterations ? ` / ${config.maxIterations}` : ""}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500 dark:text-gray-400">Started</dt>
                  <dd className="font-medium text-gray-900 dark:text-gray-100">
                    {formatDateTime(state.startedAt)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500 dark:text-gray-400">Last activity</dt>
                  <dd className="font-medium text-gray-900 dark:text-gray-100">
                    {formatDateTime(state.lastActivityAt)}
                  </dd>
                </div>
                {state.completedAt && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-gray-400">Completed</dt>
                    <dd className="font-medium text-gray-900 dark:text-gray-100">
                      {formatDateTime(state.completedAt)}
                    </dd>
                  </div>
                )}
              </dl>
            </Card>

            {/* Git info card */}
            {config.git.enabled && state.git && (
              <Card title="Git">
                <dl className="space-y-3 text-sm">
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">Original branch</dt>
                    <dd className="font-mono text-gray-900 dark:text-gray-100">
                      {state.git.originalBranch}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">Working branch</dt>
                    <dd className="font-mono text-gray-900 dark:text-gray-100">
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
                {canStart(state.status) && (
                  <Button
                    className="w-full"
                    onClick={handleStart}
                    loading={actionLoading}
                  >
                    Start Loop
                  </Button>
                )}
                {canPause(state.status) && (
                  <Button
                    className="w-full"
                    variant="secondary"
                    onClick={() => pause()}
                    loading={actionLoading}
                  >
                    Pause
                  </Button>
                )}
                {canResume(state.status) && (
                  <Button
                    className="w-full"
                    onClick={() => resume()}
                    loading={actionLoading}
                  >
                    Resume
                  </Button>
                )}
                {canStop(state.status) && (
                  <Button
                    className="w-full"
                    variant="danger"
                    onClick={() => stop()}
                    loading={actionLoading}
                  >
                    Stop Loop
                  </Button>
                )}
                {canAcceptOrDiscard(state.status) && state.git && (
                  <>
                    <Button
                      className="w-full"
                      variant="primary"
                      onClick={handleAccept}
                      loading={actionLoading}
                    >
                      Accept (Merge)
                    </Button>
                    <Button
                      className="w-full"
                      variant="ghost"
                      onClick={() => setDiscardConfirm(true)}
                    >
                      Discard Branch
                    </Button>
                  </>
                )}
                <hr className="border-gray-200 dark:border-gray-700" />
                <Button
                  className="w-full"
                  variant="ghost"
                  onClick={() => setDeleteConfirm(true)}
                >
                  Delete Loop
                </Button>
              </div>
            </Card>
          </div>

          {/* Right column - Tabs content */}
          <div className="lg:col-span-4 xl:col-span-5">
            {/* Tab navigation */}
            <div className="flex border-b border-gray-200 dark:border-gray-700 mb-4">
              {tabs.map((tab) => {
                const hasUpdate = tabsWithUpdates.has(tab.id);
                return (
                  <button
                    key={tab.id}
                    onClick={() => handleTabChange(tab.id)}
                    className={`relative px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
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
                  progressContent={progressContent}
                  maxHeight="600px"
                />
              )}

              {activeTab === "prompt" && (
                <div className="p-4">
                  <div className="mb-3">
                    <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                      Original Task Prompt
                    </h3>
                  </div>
                  <pre className="whitespace-pre-wrap text-sm text-gray-900 dark:text-gray-100 font-mono bg-gray-50 dark:bg-gray-900 rounded-md p-4">
                    {config.prompt || "No prompt specified."}
                  </pre>
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
                            className="bg-gray-50 dark:bg-gray-900 rounded text-sm overflow-hidden"
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
                              className={`w-full flex items-center gap-3 p-2 text-left ${
                                hasPatch ? "cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800" : "cursor-default"
                              }`}
                            >
                              {hasPatch && (
                                <span className="text-gray-400 flex-shrink-0">
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
                              <span className="font-mono text-gray-900 dark:text-gray-100 flex-1 truncate">
                                {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                              </span>
                              <span className="text-gray-500 dark:text-gray-400 flex-shrink-0">
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
          </div>
        </div>
      </main>

      {/* Delete confirmation modal */}
      <ConfirmModal
        isOpen={deleteConfirm}
        onClose={() => setDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Delete Loop"
        message="Are you sure you want to delete this loop? This action cannot be undone."
        confirmLabel="Delete"
        loading={actionLoading}
        variant="danger"
      />

      {/* Discard confirmation modal */}
      <ConfirmModal
        isOpen={discardConfirm}
        onClose={() => setDiscardConfirm(false)}
        onConfirm={handleDiscard}
        title="Discard Changes"
        message="Are you sure you want to discard the git branch? All uncommitted changes will be lost."
        confirmLabel="Discard"
        loading={actionLoading}
        variant="danger"
      />

      {/* Uncommitted changes modal */}
      <Modal
        isOpen={uncommittedModal.open}
        onClose={() => setUncommittedModal({ open: false, error: null })}
        title="Uncommitted Changes Detected"
        size="md"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setUncommittedModal({ open: false, error: null })}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleUncommittedDecision("stash")}
              loading={actionLoading}
            >
              Stash Changes
            </Button>
            <Button
              variant="primary"
              onClick={() => handleUncommittedDecision("commit")}
              loading={actionLoading}
            >
              Commit Changes
            </Button>
          </>
        }
      >
        {uncommittedModal.error && (
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
              {uncommittedModal.error.message}
            </p>
            {uncommittedModal.error.changedFiles.length > 0 && (
              <div className="bg-gray-50 dark:bg-gray-900 rounded-md p-3">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Changed files:
                </p>
                <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                  {uncommittedModal.error.changedFiles.slice(0, 10).map((file) => (
                    <li key={file} className="font-mono truncate">
                      {file}
                    </li>
                  ))}
                  {uncommittedModal.error.changedFiles.length > 10 && (
                    <li className="text-gray-500">
                      ...and {uncommittedModal.error.changedFiles.length - 10} more
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

export default LoopDetails;
