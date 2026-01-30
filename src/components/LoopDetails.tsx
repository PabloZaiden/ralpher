/**
 * LoopDetails component showing full loop information with tabs.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { FileDiff, FileContentResponse, ModelInfo } from "../types";
import type { ReviewComment } from "../types/loop";
import { useLoop } from "../hooks";
import { Badge, Button, getStatusBadgeVariant } from "./common";
import { LogViewer } from "./LogViewer";
import { TodoViewer } from "./TodoViewer";
import { MarkdownRenderer } from "./MarkdownRenderer";
import {
  AcceptLoopModal,
  AddressCommentsModal,
  DeleteLoopModal,
  PurgeLoopModal,
  MarkMergedModal,
} from "./LoopModals";
import { PlanReviewPanel } from "./PlanReviewPanel";
import { LoopActionBar } from "./LoopActionBar";
import {
  getStatusLabel,
  canAccept,
  isFinalState,
  isLoopActive,
  canJumpstart,
} from "../utils";

export interface LoopDetailsProps {
  /** Loop ID to display */
  loopId: string;
  /** Callback to go back to dashboard */
  onBack?: () => void;
}

type TabId = "log" | "prompt" | "plan" | "status" | "diff" | "review" | "actions";

const tabs: { id: TabId; label: string }[] = [
  { id: "log", label: "Log" },
  { id: "prompt", label: "Prompt" },
  { id: "plan", label: "Plan" },
  { id: "status", label: "Status" },
  { id: "diff", label: "Diff" },
  { id: "review", label: "Review" },
  { id: "actions", label: "Actions" },
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
    todos,
    gitChangeCounter,
    accept,
    push,
    remove,
    purge,
    markMerged,
    setPending,
    clearPending,
    getDiff,
    getPlan,
    getStatusFile,
    sendPlanFeedback,
    acceptPlan,
    discardPlan,
    addressReviewComments,
  } = useLoop(loopId);

  const [activeTab, setActiveTab] = useState<TabId>("log");
  const [planContent, setPlanContent] = useState<FileContentResponse | null>(null);
  const [statusContent, setStatusContent] = useState<FileContentResponse | null>(null);
  const [diffContent, setDiffContent] = useState<FileDiff[]>([]);
  const [loadingContent, setLoadingContent] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [reviewComments, setReviewComments] = useState<ReviewComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [showDebugLogs, setShowDebugLogs] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  // Collapse/expand state for Logs and TODOs sections
  const [logsCollapsed, setLogsCollapsed] = useState(false);
  const [todosCollapsed, setTodosCollapsed] = useState(false);

  // Track which tabs have unseen updates
  const [tabsWithUpdates, setTabsWithUpdates] = useState<Set<TabId>>(new Set());
  
  // Track previous values to detect changes
  const prevMessagesCount = useRef(0);
  const prevToolCallsCount = useRef(0);
  const prevLogsCount = useRef(0);
  const prevPlanContent = useRef<string | null>(null);
  const prevStatusContent = useRef<string | null>(null);
  const prevActionsState = useRef<string | null>(null);

  // Modals
  const [deleteModal, setDeleteModal] = useState(false);
  const [acceptModal, setAcceptModal] = useState(false);
  const [purgeModal, setPurgeModal] = useState(false);
  const [markMergedModal, setMarkMergedModal] = useState(false);
  const [addressCommentsModal, setAddressCommentsModal] = useState(false);

  // Models state for LoopActionBar
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  // Function to fetch review comments
  const fetchReviewComments = useCallback(async () => {
    setLoadingComments(true);
    try {
      const response = await fetch(`/api/loops/${loopId}/comments`);
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.comments) {
          setReviewComments(data.comments);
        }
      }
    } catch (error) {
      console.error("Failed to fetch review comments:", String(error));
    } finally {
      setLoadingComments(false);
    }
  }, [loopId]);

  // Fetch models when loop directory is available
  useEffect(() => {
    if (!loop?.config.directory) return;

    async function fetchModels() {
      setModelsLoading(true);
      try {
        const response = await fetch(`/api/models?directory=${encodeURIComponent(loop!.config.directory)}`);
        if (response.ok) {
          const data = await response.json() as ModelInfo[];
          setModels(data);
        }
      } catch (error) {
        console.error("Failed to fetch models:", String(error));
      } finally {
        setModelsLoading(false);
      }
    }

    fetchModels();
  }, [loop?.config.directory]);

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

  // Detect changes in available actions
  useEffect(() => {
    if (!loop) return;
    
    // Create a string representation of the current actions state
    const isFinal = isFinalState(loop.state.status);
    const hasAddressable = loop.state.reviewMode?.addressable ?? false;
    const hasAccept = canAccept(loop.state.status) && !!loop.state.git;
    const currentActionsState = `${isFinal}-${hasAddressable}-${hasAccept}-${loop.state.status}`;
    
    if (prevActionsState.current !== null && currentActionsState !== prevActionsState.current && activeTab !== "actions") {
      setTabsWithUpdates((prev) => new Set(prev).add("actions"));
    }
    prevActionsState.current = currentActionsState;
  }, [loop?.state.status, loop?.state.reviewMode?.addressable, loop?.state.git, activeTab, loop]);

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
        } else if (activeTab === "review") {
          // Fetch review comments
          await fetchReviewComments();
        }
      } finally {
        setLoadingContent(false);
      }
    }

    if (activeTab !== "log" && activeTab !== "prompt") {
      loadContent();
    }
  }, [activeTab, getPlan, getStatusFile, getDiff, fetchReviewComments]);

  // Load plan content when in planning mode
  // This is needed because the tab-based loading above only works when the "plan" tab is selected,
  // but in planning mode we show PlanReviewPanel instead of tabs
  useEffect(() => {
    async function loadPlanForPlanningMode() {
      if (loop?.state.status === "planning") {
        try {
          const content = await getPlan();
          setPlanContent(content);
        } catch {
          // Ignore errors - plan might not exist yet
        }
      }
    }
    loadPlanForPlanningMode();
  }, [loop?.state.status, getPlan, gitChangeCounter]);

  // Refetch comments when loop state changes (comment submitted or loop completes)
  // This ensures the review tab auto-updates without needing to switch tabs
  useEffect(() => {
    // Only fetch if loop has review mode and we're on the review tab
    if (loop?.state.reviewMode && activeTab === "review") {
      fetchReviewComments();
    }
  }, [loop?.state.reviewMode?.reviewCycles, loop?.state.status, activeTab, fetchReviewComments]);

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

  // Handle mark as merged
  async function handleMarkMerged() {
    const success = await markMerged();
    if (success) {
      onBack?.();
    }
    setMarkMergedModal(false);
  }

  // Handle address comments
  async function handleAddressComments(comments: string) {
    try {
      const result = await addressReviewComments(comments);
      if (!result.success) {
        throw new Error("Failed to address comments");
      }
      // Fetch updated comments after successfully submitting
      await fetchReviewComments();
    } catch (error) {
      console.error("Failed to address comments:", error);
      throw error; // Re-throw so modal knows it failed
    }
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
    <div className="h-screen bg-gray-50 dark:bg-gray-900 flex flex-col overflow-hidden">
      {/* Header - compact single line */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <div className="px-4 sm:px-6 lg:px-8 py-2">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={onBack}>
              ← Back
            </Button>
            <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate">
              {config.name}
            </h1>
            <Badge variant={getStatusBadgeVariant(state.status)} size="sm">
              {getStatusLabel(state.status)}
            </Badge>
            {isActive && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
              </span>
            )}
            <span className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate hidden sm:inline">
              {config.directory}
            </span>
            {/* Spacer */}
            <div className="flex-1" />
            {/* WebSocket Status */}
            <div className="flex items-center gap-1.5 text-xs">
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

      {/* Compact info bar with Stats and Git */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 sm:px-6 lg:px-8 py-1.5 flex-shrink-0">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {/* Statistics */}
          <span className="text-gray-500 dark:text-gray-400">
            Iteration: <span className="font-medium text-gray-900 dark:text-gray-100">{state.currentIteration}{config.maxIterations ? ` / ${config.maxIterations}` : ""}</span>
          </span>
          <span className="text-gray-500 dark:text-gray-400">
            Started: <span className="font-medium text-gray-900 dark:text-gray-100">{formatDateTime(state.startedAt)}</span>
          </span>
          <span className="text-gray-500 dark:text-gray-400">
            Last: <span className="font-medium text-gray-900 dark:text-gray-100">{formatDateTime(state.lastActivityAt)}</span>
          </span>
          {state.completedAt && (
            <span className="text-gray-500 dark:text-gray-400">
              Completed: <span className="font-medium text-gray-900 dark:text-gray-100">{formatDateTime(state.completedAt)}</span>
            </span>
          )}
          
          {/* Git info - no pipe separator */}
          {state.git && (
            <>
              <span className="text-gray-500 dark:text-gray-400">
                Branch: <span className="font-mono font-medium text-gray-900 dark:text-gray-100">{state.git.originalBranch}</span>
                <span className="text-gray-400 dark:text-gray-500"> → </span>
                <span className="font-mono font-medium text-gray-900 dark:text-gray-100">{state.git.workingBranch}</span>
              </span>
              <span className="text-gray-500 dark:text-gray-400">
                Commits: <span className="font-medium text-gray-900 dark:text-gray-100">{state.git.commits.length}</span>
              </span>
            </>
          )}

          {/* Model info */}
          <span className="text-gray-500 dark:text-gray-400">
            Model: <span className="font-medium text-gray-900 dark:text-gray-100">
              {config.model 
                ? `${config.model.modelID}`
                : "Default"
              }
            </span>
            {state.pendingModel && (
              <span className="ml-1 text-yellow-600 dark:text-yellow-400">
                → {state.pendingModel.modelID}
              </span>
            )}
          </span>
        </div>
      </div>

      <main className="px-4 sm:px-6 lg:px-8 py-3 flex flex-col flex-1 min-h-0 overflow-hidden">
        {/* Error display */}
        {error && (
          <div className="mb-3 rounded-md bg-red-50 dark:bg-red-900/20 p-3 flex-shrink-0">
            <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* Full width content area */}
        <div className="flex-1 min-h-0 flex flex-col">
            {state.status === "planning" ? (
              <PlanReviewPanel
                loop={loop}
                planContent={planContent?.content ?? ""}
                isPlanReady={loop.state.planMode?.isPlanReady ?? false}
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
                messages={messages}
                toolCalls={toolCalls}
                logs={logs}
              />
            ) : (
              <div className="flex flex-col flex-1 min-h-0">
                {/* Tab navigation */}
                <div className="flex border-b border-gray-200 dark:border-gray-700 mb-3 overflow-x-auto flex-shrink-0">
                  {tabs.map((tab) => {
                    const hasUpdate = tabsWithUpdates.has(tab.id);
                    return (
                      <button
                        key={tab.id}
                        onClick={() => handleTabChange(tab.id)}
                        className={`relative px-2 sm:px-4 py-1.5 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                          activeTab === tab.id
                            ? "border-blue-500 text-blue-600 dark:text-blue-400"
                            : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                        }`}
                      >
                        {tab.label}
                        {hasUpdate && activeTab !== tab.id && (
                          <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-blue-500" />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Tab content */}
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 flex-1 min-h-0 flex flex-col">
                  {activeTab === "log" && (
                    <div className="flex-1 min-h-0 flex flex-col">
                      {/* Side-by-side layout for logs and TODOs (75-25 split) */}
                      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4 p-4">
                        {/* Logs section */}
                        <div className={`flex flex-col min-w-0 ${
                          logsCollapsed ? 'flex-shrink-0' : `min-h-[100px] lg:min-h-0 ${todosCollapsed ? 'flex-1' : 'flex-[3]'}`
                        }`}>
                          <button
                            onClick={() => setLogsCollapsed(!logsCollapsed)}
                            className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex-shrink-0 flex items-center gap-2 hover:text-gray-900 dark:hover:text-gray-100 transition-colors text-left"
                            aria-expanded={!logsCollapsed}
                            aria-controls="logs-viewer"
                          >
                            <span className="text-xs">{logsCollapsed ? "▶" : "▼"}</span>
                            <span>Logs</span>
                          </button>
                          {!logsCollapsed && (
                            <LogViewer
                              id="logs-viewer"
                              messages={messages}
                              toolCalls={toolCalls}
                              logs={logs}
                              showDebugLogs={showDebugLogs}
                              autoScroll={autoScroll}
                            />
                          )}
                        </div>
                        
                        {/* TODOs section */}
                        <div className={`flex flex-col min-w-0 ${
                          todosCollapsed ? 'flex-shrink-0' : `min-h-[100px] lg:min-h-0 ${logsCollapsed ? 'flex-1' : 'flex-1'}`
                        }`}>
                          <button
                            onClick={() => setTodosCollapsed(!todosCollapsed)}
                            className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex-shrink-0 flex items-center gap-2 hover:text-gray-900 dark:hover:text-gray-100 transition-colors text-left"
                            aria-expanded={!todosCollapsed}
                            aria-controls="todos-viewer"
                          >
                            <span className="text-xs">{todosCollapsed ? "▶" : "▼"}</span>
                            <span>TODOs</span>
                          </button>
                          {!todosCollapsed && (
                            <TodoViewer id="todos-viewer" todos={todos} />
                          )}
                        </div>
                      </div>
                      
                      {/* Debug logs and autoscroll toggles at the bottom */}
                      <div className="p-3 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
                        <div className="flex flex-wrap items-center gap-4">
                          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={showDebugLogs}
                              onChange={(e) => setShowDebugLogs(e.target.checked)}
                              className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 focus:ring-offset-0"
                            />
                            <span>Show debug logs</span>
                          </label>
                          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={autoScroll}
                              onChange={(e) => setAutoScroll(e.target.checked)}
                              className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 focus:ring-offset-0"
                            />
                            <span>Autoscroll</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === "prompt" && (
                    <div className="p-4 space-y-6 flex-1 min-h-0 overflow-auto dark-scrollbar">
                      {/* Original Task Prompt (read-only) */}
                      <div>
                        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                          Original Task Prompt
                        </h3>
                        <pre className="whitespace-pre-wrap text-sm text-gray-900 dark:text-gray-100 font-mono bg-gray-50 dark:bg-gray-900 rounded-md p-4">
                          {config.prompt || "No prompt specified."}
                        </pre>
                      </div>

                      {/* Pending prompt status (read-only) */}
                      {state.pendingPrompt && (
                        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                          <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-200 mb-2">
                            Queued Message
                          </h3>
                          <pre className="whitespace-pre-wrap text-sm text-yellow-700 dark:text-yellow-300 font-mono">
                            {state.pendingPrompt}
                          </pre>
                          <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-2">
                            This message will be sent after the current step completes.
                          </p>
                        </div>
                      )}

                      {/* Pending model status (read-only) */}
                      {state.pendingModel && (
                        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                          <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
                            Model Change Queued
                          </h3>
                          <p className="text-sm text-blue-700 dark:text-blue-300">
                            Model will change to <span className="font-mono font-medium">{state.pendingModel.modelID}</span> after the current step.
                          </p>
                        </div>
                      )}

                      {/* Tip for using action bar */}
                      {isActive && !state.pendingPrompt && !state.pendingModel && (
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Use the action bar at the bottom to send a message or change the model while the loop is running.
                        </p>
                      )}

                      {/* Info message when loop is not running */}
                      {!isActive && !state.pendingPrompt && !state.pendingModel && (
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Messages can only be queued while the loop is running.
                        </p>
                      )}
                    </div>
                  )}

                  {activeTab === "plan" && (
                    <div className="p-4 flex-1 min-h-0 overflow-auto dark-scrollbar">
                      {loadingContent ? (
                        <div className="flex justify-center py-8">
                          <div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-500 border-t-transparent" />
                        </div>
                      ) : planContent?.exists ? (
                        <MarkdownRenderer content={planContent.content} />
                      ) : (
                        <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                          No plan.md file found in the project directory.
                        </p>
                      )}
                    </div>
                  )}

                  {activeTab === "status" && (
                    <div className="p-4 flex-1 min-h-0 overflow-auto dark-scrollbar">
                      {loadingContent ? (
                        <div className="flex justify-center py-8">
                          <div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-500 border-t-transparent" />
                        </div>
                      ) : statusContent?.exists ? (
                        <MarkdownRenderer content={statusContent.content} />
                      ) : (
                        <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                          No status.md file found in the project directory.
                        </p>
                      )}
                    </div>
                  )}

                  {activeTab === "diff" && (
                    <div className="p-4 flex-1 min-h-0 overflow-auto dark-scrollbar">
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

                  {activeTab === "review" && (
                    <div className="p-4 space-y-4 flex-1 min-h-0 overflow-auto dark-scrollbar">
                      {loop.state.reviewMode ? (
                        <>
                          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                            <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-3">
                              Review Mode Status
                            </h3>
                            <div className="space-y-2 text-sm">
                              <div className="flex justify-between">
                                <span className="text-gray-600 dark:text-gray-400">Addressable:</span>
                                <span className="font-medium text-gray-900 dark:text-gray-100">
                                  {loop.state.reviewMode.addressable ? "Yes" : "No"}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-600 dark:text-gray-400">Completion Action:</span>
                                <span className="font-medium text-gray-900 dark:text-gray-100 capitalize">
                                  {loop.state.reviewMode.completionAction}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-600 dark:text-gray-400">Review Cycles:</span>
                                <span className="font-medium text-gray-900 dark:text-gray-100">
                                  {loop.state.reviewMode.reviewCycles}
                                </span>
                              </div>
                            </div>
                          </div>

                          {loop.state.reviewMode.reviewBranches.length > 0 && (
                            <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                                Review Branches
                              </h3>
                              <div className="space-y-2">
                                {loop.state.reviewMode.reviewBranches.map((branch, index) => (
                                  <div
                                    key={index}
                                    className="flex items-center gap-2 text-sm font-mono text-gray-700 dark:text-gray-300"
                                  >
                                    <span className="text-gray-400">{index + 1}.</span>
                                    <span>{branch}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Comment History */}
                          <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                              Comment History
                            </h3>
                            
                            {loadingComments ? (
                              <div className="text-center py-4">
                                <span className="text-sm text-gray-500 dark:text-gray-400">
                                  Loading comments...
                                </span>
                              </div>
                            ) : reviewComments.length === 0 ? (
                              <p className="text-sm text-gray-500 dark:text-gray-400">
                                No comments yet.
                              </p>
                            ) : (
                              <div className="space-y-4">
                                {/* Group comments by review cycle */}
                                {Object.entries(
                                  reviewComments.reduce((acc, comment) => {
                                    const cycleComments = acc[comment.reviewCycle] ?? [];
                                    cycleComments.push(comment);
                                    acc[comment.reviewCycle] = cycleComments;
                                    return acc;
                                  }, {} as Record<number, ReviewComment[]>)
                                )
                                  .sort(([cycleA], [cycleB]) => Number(cycleA) - Number(cycleB))
                                  .map(([cycle, comments]) => (
                                    <div key={cycle} className="border-l-2 border-gray-300 dark:border-gray-600 pl-3">
                                      <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                        Review Cycle {cycle}
                                      </h4>
                                      <div className="space-y-2">
                                        {comments.map((comment) => (
                                          <div
                                            key={comment.id}
                                            className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-3"
                                          >
                                            <div className="flex items-start justify-between gap-2 mb-2">
                                              <span
                                                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                                  comment.status === "addressed"
                                                    ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300"
                                                    : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300"
                                                }`}
                                              >
                                                {comment.status === "addressed" ? "Addressed" : "Pending"}
                                              </span>
                                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                                {new Date(comment.createdAt).toLocaleString()}
                                              </span>
                                            </div>
                                            <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                                              {comment.commentText}
                                            </p>
                                            {comment.addressedAt && (
                                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                                                Addressed on {new Date(comment.addressedAt).toLocaleString()}
                                              </p>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ))}
                              </div>
                            )}
                          </div>

                          <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
                              About Review Mode
                            </h3>
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                              This loop can receive reviewer comments and address them iteratively.
                              {loop.state.reviewMode.completionAction === "push"
                                ? " Pushed loops continue adding commits to the same branch."
                                : " Merged loops create new review branches for each cycle."}
                            </p>
                          </div>
                        </>
                      ) : (
                        <div className="text-center py-8">
                          <p className="text-gray-500 dark:text-gray-400">
                            This loop does not have review mode enabled.
                          </p>
                          <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">
                            Review mode is automatically enabled when a loop is pushed or merged.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {activeTab === "actions" && (
                    <div className="p-4 flex-1 min-h-0 overflow-auto dark-scrollbar">
                      <div className="max-w-md space-y-2">
                        {isFinalState(state.status) ? (
                          <>
                            {state.reviewMode?.addressable && state.status !== "deleted" && (
                              <button
                                onClick={() => setAddressCommentsModal(true)}
                                className="w-full flex items-center gap-4 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left"
                              >
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                                  <span className="text-blue-600 dark:text-blue-400 text-sm">💬</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Address Comments</div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400">Submit comments for the next review cycle</div>
                                </div>
                                <span className="text-gray-400 dark:text-gray-500">→</span>
                              </button>
                            )}
                            {state.git && state.status !== "deleted" && (
                              <button
                                onClick={() => setMarkMergedModal(true)}
                                className="w-full flex items-center gap-4 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left"
                              >
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                                  <span className="text-green-600 dark:text-green-400 text-sm">⤵</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Mark as Merged</div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400">Switch to base branch, pull changes, and clean up</div>
                                </div>
                                <span className="text-gray-400 dark:text-gray-500">→</span>
                              </button>
                            )}
                            <button
                              onClick={() => setPurgeModal(true)}
                              className="w-full flex items-center gap-4 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left"
                            >
                              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                                <span className="text-red-600 dark:text-red-400 text-sm">🗑</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Purge Loop</div>
                                <div className="text-xs text-gray-500 dark:text-gray-400">Delete this loop and all associated data</div>
                              </div>
                              <span className="text-gray-400 dark:text-gray-500">→</span>
                            </button>
                          </>
                        ) : (
                          <>
                            {canAccept(state.status) && state.git && (
                              <button
                                onClick={() => setAcceptModal(true)}
                                className="w-full flex items-center gap-4 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left"
                              >
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                                  <span className="text-green-600 dark:text-green-400 text-sm">✓</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Accept</div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400">Accept changes and merge or push to remote</div>
                                </div>
                                <span className="text-gray-400 dark:text-gray-500">→</span>
                              </button>
                            )}
                            <button
                              onClick={() => setDeleteModal(true)}
                              className="w-full flex items-center gap-4 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left"
                            >
                              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                                <span className="text-red-600 dark:text-red-400 text-sm">✗</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Delete Loop</div>
                                <div className="text-xs text-gray-500 dark:text-gray-400">Cancel and delete this loop</div>
                              </div>
                              <span className="text-gray-400 dark:text-gray-500">→</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
        </div>
      </main>

      {/* LoopActionBar for mid-loop messaging (active loops and jumpstartable loops) */}
      {(isActive || canJumpstart(state.status)) && (
        <LoopActionBar
          currentModel={config.model}
          pendingModel={state.pendingModel}
          pendingPrompt={state.pendingPrompt}
          models={models}
          modelsLoading={modelsLoading}
          onQueuePending={async (options) => {
            const result = await setPending(options);
            return result.success;
          }}
          onClearPending={async () => {
            return await clearPending();
          }}
        />
      )}

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
        restrictToAction={state.reviewMode?.completionAction}
      />

      {/* Purge confirmation modal */}
      <PurgeLoopModal
        isOpen={purgeModal}
        onClose={() => setPurgeModal(false)}
        onPurge={handlePurge}
      />

      {/* Mark as Merged confirmation modal */}
      <MarkMergedModal
        isOpen={markMergedModal}
        onClose={() => setMarkMergedModal(false)}
        onMarkMerged={handleMarkMerged}
      />

      {/* Address Comments modal */}
      <AddressCommentsModal
        isOpen={addressCommentsModal}
        onClose={() => setAddressCommentsModal(false)}
        onSubmit={handleAddressComments}
        loopName={config.name}
        reviewCycle={(state.reviewMode?.reviewCycles || 0) + 1}
      />
    </div>
  );
}

export default LoopDetails;
