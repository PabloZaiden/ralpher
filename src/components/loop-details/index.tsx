/**
 * LoopDetails component showing full loop information with tabs.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { FileDiff, FileContentResponse, ModelInfo, PullRequestDestinationResponse } from "../../types";
import type { ReviewComment } from "../../types/loop";
import { useLoop, useLoopPortForwards, useMarkdownPreference, useToast } from "../../hooks";
import { Badge, Button, ConfirmModal, getStatusBadgeVariant, EditIcon } from "../common";
import {
  AcceptLoopModal,
  AddressCommentsModal,
  DeleteLoopModal,
  PurgeLoopModal,
  MarkMergedModal,
  UpdateBranchModal,
  RenameLoopModal,
} from "../LoopModals";
import { LoopActionBar } from "../LoopActionBar";
import {
  getStatusLabel,
  getPlanningStatusLabel,
  canAccept,
  isFinalState,
  isLoopActive,
  canSendTerminalFollowUp,
  getEntityLabel,
} from "../../utils";
import { writeTextToClipboard } from "../../utils";
import { appAbsoluteUrl, appPath, appFetch } from "../../lib/public-path";
import { log } from "../../lib/logger";
import type { TabId } from "./types";
import { tabs, formatDateTime } from "./types";
import { LogTab } from "./log-tab";
import { InfoTab } from "./info-tab";
import { PromptTab } from "./prompt-tab";
import { PlanTab } from "./plan-tab";
import { StatusTab } from "./status-tab";
import { DiffTab } from "./diff-tab";
import { ReviewTab } from "./review-tab";
import { ActionsTab } from "./actions-tab";

export interface LoopDetailsProps {
  /** Loop ID to display */
  loopId: string;
  /** Callback to go back to dashboard */
  onBack?: () => void;
  /** Whether to render the back button in shell layouts */
  showBackButton?: boolean;
  /** Left offset used when the shell keeps the collapsed-sidebar trigger visible */
  headerOffsetClassName?: string;
  /** Navigate to the SSH session details view */
  onSelectSshSession?: (sshSessionId: string) => void;
}

export function LoopDetails({
  loopId,
  onBack,
  showBackButton = true,
  headerOffsetClassName,
  onSelectSshSession,
}: LoopDetailsProps) {
  const {
    loop,
    loading,
    error,
    messages,
    toolCalls,
    logs,
    todos,
    gitChangeCounter,
    isChatMode,
    accept,
    push,
    updateBranch,
    remove,
    purge,
    markMerged,
    setPending,
    clearPending,
    sendChatMessage,
    sendFollowUp,
    getDiff,
    getPlan,
    getStatusFile,
    getPullRequestDestination,
    sendPlanFeedback,
    answerPlanQuestion,
    acceptPlan,
    discardPlan,
    addressReviewComments,
    update,
    connectViaSsh,
  } = useLoop(loopId);

  // Markdown rendering preference
  const { enabled: markdownEnabled } = useMarkdownPreference();
  const toast = useToast();
  const {
    forwards,
    loading: forwardsLoading,
    error: forwardsError,
    createForward,
    deleteForward,
  } = useLoopPortForwards(loopId);

  const [activeTab, setActiveTab] = useState<TabId>("log");
  const [planContent, setPlanContent] = useState<FileContentResponse | null>(null);
  const [statusContent, setStatusContent] = useState<FileContentResponse | null>(null);
  const [diffContent, setDiffContent] = useState<FileDiff[]>([]);
  const [loadingContent, setLoadingContent] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [reviewComments, setReviewComments] = useState<ReviewComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [pullRequestDestination, setPullRequestDestination] = useState<PullRequestDestinationResponse | null>(null);
  const [loadingPullRequestDestination, setLoadingPullRequestDestination] = useState(false);
  const [showSystemInfo, setShowSystemInfo] = useState(false);
  const [showReasoning, setShowReasoning] = useState(true);
  const [showTools, setShowTools] = useState(false);
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
  const pullRequestDestinationRequestId = useRef(0);
  const prevStatusContent = useRef<string | null>(null);
  const prevActionsState = useRef<string | null>(null);
  const initialTabSet = useRef(false);

  // Modals
  const [deleteModal, setDeleteModal] = useState(false);
  const [acceptModal, setAcceptModal] = useState(false);
  const [purgeModal, setPurgeModal] = useState(false);
  const [markMergedModal, setMarkMergedModal] = useState(false);
  const [addressCommentsModal, setAddressCommentsModal] = useState(false);
  const [renameModal, setRenameModal] = useState(false);
  const [updateBranchModal, setUpdateBranchModal] = useState(false);
  const [discardPlanModal, setDiscardPlanModal] = useState(false);
  const [planActionSubmitting, setPlanActionSubmitting] = useState(false);
  const [planQuestionSelections, setPlanQuestionSelections] = useState<string[][]>([]);
  const [planQuestionCustomAnswers, setPlanQuestionCustomAnswers] = useState<string[]>([]);
  const [planQuestionSubmitting, setPlanQuestionSubmitting] = useState(false);
  const [sshConnecting, setSshConnecting] = useState(false);

  // Models state for LoopActionBar
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [newForwardPort, setNewForwardPort] = useState("");
  const [creatingForward, setCreatingForward] = useState(false);

  // Function to fetch review comments
  const fetchReviewComments = useCallback(async () => {
    setLoadingComments(true);
    try {
      const response = await appFetch(`/api/loops/${loopId}/comments`);
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.comments) {
          setReviewComments(data.comments);
        }
      }
    } catch (error) {
      log.error("Failed to fetch review comments:", String(error));
    } finally {
      setLoadingComments(false);
    }
  }, [loopId]);

  // Fetch models when loop directory is available
  useEffect(() => {
    if (!loop?.config.directory || !loop?.config.workspaceId) return;

    const directory = loop.config.directory;
    const workspaceId = loop.config.workspaceId;
    const controller = new AbortController();

    async function fetchModels() {
      setModelsLoading(true);
      try {
        const response = await appFetch(
          `/api/models?directory=${encodeURIComponent(directory)}&workspaceId=${encodeURIComponent(workspaceId)}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) {
          return;
        }
        if (response.ok) {
          const data = await response.json() as ModelInfo[];
          if (controller.signal.aborted) {
            return;
          }
          setModels(data);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        log.error("Failed to fetch models:", String(error));
      } finally {
        if (!controller.signal.aborted) {
          setModelsLoading(false);
        }
      }
    }

    void fetchModels();

    return () => {
      controller.abort();
    };
  }, [loop?.config.directory, loop?.config.workspaceId]);

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
    const planReady = loop.state.planMode?.isPlanReady ?? false;
    const currentActionsState = `${isFinal}-${hasAddressable}-${hasAccept}-${loop.state.status}-${planReady}`;
    
    if (prevActionsState.current !== null && currentActionsState !== prevActionsState.current && activeTab !== "actions") {
      setTabsWithUpdates((prev) => new Set(prev).add("actions"));
    }
    prevActionsState.current = currentActionsState;
  }, [loop?.state.status, loop?.state.reviewMode?.addressable, loop?.state.git, loop?.state.planMode?.isPlanReady, activeTab, loop]);

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
  // This ensures plan content stays fresh during planning regardless of which tab is active
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

  useEffect(() => {
    const requestId = ++pullRequestDestinationRequestId.current;
    let isCancelled = false;

    async function loadPullRequestDestination() {
      if (loop?.state.status !== "pushed" || loop.state.reviewMode?.addressable !== true) {
        if (!isCancelled && requestId === pullRequestDestinationRequestId.current) {
          setPullRequestDestination(null);
          setLoadingPullRequestDestination(false);
        }
        return;
      }

      setLoadingPullRequestDestination(true);
      try {
        const destination = await getPullRequestDestination();
        if (!isCancelled && requestId === pullRequestDestinationRequestId.current) {
          setPullRequestDestination(destination);
        }
      } finally {
        if (!isCancelled && requestId === pullRequestDestinationRequestId.current) {
          setLoadingPullRequestDestination(false);
        }
      }
    }

    loadPullRequestDestination();

    return () => {
      isCancelled = true;
    };
  }, [
    loop?.state.status,
    loop?.state.reviewMode?.addressable,
    loop?.state.reviewMode?.reviewCycles,
    loop?.state.git?.workingBranch,
    loop?.config.baseBranch,
    getPullRequestDestination,
  ]);

  // Reset initialTabSet when loopId changes so a new planning loop can auto-switch to Plan tab
  useEffect(() => {
    initialTabSet.current = false;
  }, [loopId]);

  // Default to "plan" tab when in planning mode on initial load
  const isCurrentlyPlanning = loop?.state.status === "planning" && !isChatMode;
  const pendingPlanQuestion = loop?.state.planMode?.pendingQuestion;
  useEffect(() => {
    if (isCurrentlyPlanning && !initialTabSet.current) {
      setActiveTab(pendingPlanQuestion ? "log" : "plan");
      initialTabSet.current = true;
    }
  }, [isCurrentlyPlanning, pendingPlanQuestion]);

  useEffect(() => {
    if (pendingPlanQuestion && activeTab === "plan") {
      setActiveTab("log");
    }
  }, [activeTab, pendingPlanQuestion?.requestId]);

  useEffect(() => {
    if (!pendingPlanQuestion) {
      setPlanQuestionSelections([]);
      setPlanQuestionCustomAnswers([]);
      return;
    }

    setPlanQuestionSelections(pendingPlanQuestion.questions.map(() => []));
    setPlanQuestionCustomAnswers(pendingPlanQuestion.questions.map(() => ""));
  }, [pendingPlanQuestion?.requestId]);

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

  // Handle update branch
  async function handleUpdateBranch() {
    const result = await updateBranch();
    if (!result.success) {
      toast.error("Failed to update branch");
      setUpdateBranchModal(false);
      return;
    }
    setUpdateBranchModal(false);
  }

  // Handle mark as merged
  async function handleMarkMerged() {
    await markMerged();
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
      log.error("Failed to address comments:", error);
      throw error; // Re-throw so modal knows it failed
    }
  }

  function handleOpenPullRequest() {
    if (!pullRequestDestination?.enabled) {
      return;
    }

    window.open(pullRequestDestination.url, "_blank", "noopener,noreferrer");
  }

  function navigateToSshSession(sshSessionId: string) {
    if (onSelectSshSession) {
      onSelectSshSession(sshSessionId);
    } else {
      window.location.hash = `/ssh/${sshSessionId}`;
    }
  }

  // Handle accept plan
  async function handleAcceptPlan(mode: "start_loop" | "open_ssh" = "start_loop") {
    setPlanActionSubmitting(true);
    try {
      const result = await acceptPlan(mode);
      if (!result.success) {
        toast.error(mode === "open_ssh" ? "Failed to accept plan and open SSH" : "Failed to accept plan");
        return;
      }
      if (result.mode === "open_ssh") {
        navigateToSshSession(result.sshSession.config.id);
      }
    } finally {
      setPlanActionSubmitting(false);
    }
  }

  // Handle discard plan
  async function handleDiscardPlan() {
    setPlanActionSubmitting(true);
    try {
      await discardPlan();
    } finally {
      // Clean up local state before navigating away to avoid
      // setState on unmounted component if onBack() triggers unmount
      setPlanActionSubmitting(false);
      setDiscardPlanModal(false);
    }
    // Navigate after state cleanup so we don't setState on an unmounted component
    onBack?.();
  }

  async function handleAnswerPlanQuestion() {
    if (!pendingPlanQuestion) {
      return;
    }

    const answers = pendingPlanQuestion.questions.map((question, index) => {
      const customAnswer = planQuestionCustomAnswers[index]?.trim();
      if (customAnswer) {
        return [customAnswer];
      }

      if (question.multiple) {
        return planQuestionSelections[index] ?? [];
      }

      const selected = planQuestionSelections[index]?.[0];
      return selected ? [selected] : [];
    });

    const hasMissingAnswer = answers.some((answerGroup) => answerGroup.length === 0);
    if (hasMissingAnswer) {
      toast.error("Answer every pending question before submitting.");
      return;
    }

    setPlanQuestionSubmitting(true);
    try {
      const success = await answerPlanQuestion(answers);
      if (!success) {
        toast.error("Failed to answer plan question");
      }
    } finally {
      setPlanQuestionSubmitting(false);
    }
  }

  async function handleConnectViaSsh() {
    setSshConnecting(true);
    try {
      const session = await connectViaSsh();
      if (!session) {
        toast.error("Failed to connect via ssh");
        return;
      }
      navigateToSshSession(session.config.id);
    } finally {
      setSshConnecting(false);
    }
  }

  async function handleCreateForward() {
    const remotePort = Number(newForwardPort);
    if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) {
      toast.error("Enter a valid remote port between 1 and 65535");
      return;
    }

    setCreatingForward(true);
    try {
      const forward = await createForward({
        remotePort,
      });
      if (!forward) {
        toast.error("Failed to create port forward");
        return;
      }
      setNewForwardPort("");
    } finally {
      setCreatingForward(false);
    }
  }

  async function handleDeleteForward(forwardId: string) {
    const success = await deleteForward(forwardId);
    if (!success) {
      toast.error("Failed to delete port forward");
      return;
    }
  }

  async function handleCopyForwardUrl(forwardId: string) {
    const absoluteUrl = appAbsoluteUrl(`/loop/${loopId}/port/${forwardId}/`);
    try {
      await writeTextToClipboard(absoluteUrl);
    } catch (error) {
      toast.error(`Failed to copy URL: ${String(error)}`);
    }
  }

  function handleOpenForward(forwardId: string) {
    window.open(appPath(`/loop/${loopId}/port/${forwardId}/`), "_blank", "noopener,noreferrer");
  }

  if (loading && !loop) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-500 border-t-transparent" />
      </div>
    );
  }

  if (!loop) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-neutral-900 p-8">
        <div className="w-full">
          {showBackButton && onBack && (
            <Button variant="ghost" onClick={onBack}>
              ← Back
            </Button>
          )}
          <div className="mt-8 text-center">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              Not found
            </h2>
            <p className="mt-2 text-gray-500 dark:text-gray-400">
              {error || "The requested item does not exist."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { config, state } = loop;
  const isActive = isLoopActive(state.status);
  const labels = getEntityLabel(config.mode);
  const isPlanning = state.status === "planning" && !isChatMode;
  const canTerminalFollowUp = canSendTerminalFollowUp(state.status, state.reviewMode?.addressable);
  const isPlanReady = loop.state.planMode?.isPlanReady ?? false;
  const feedbackRounds = loop.state.planMode?.feedbackRounds ?? 0;
  // Planning-active: AI is generating/revising the plan (not yet ready for review)
  const isPlanningActive = isPlanning && !isPlanReady;
  // Log panel should show spinner during both regular activity and active planning
  const isLogActive = isActive || isPlanningActive;
  // Filter tabs for chat mode: hide Prompt and Plan tabs
  const visibleTabs = isChatMode
    ? tabs.filter((tab) => tab.id !== "prompt" && tab.id !== "plan")
    : tabs;

  return (
    <div className="h-full bg-gray-50 dark:bg-neutral-900 flex flex-col overflow-hidden">
      {/* Header - compact single line */}
      <header className="bg-white dark:bg-neutral-800 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 safe-area-top">
        <div className="px-4 sm:px-6 lg:px-8 py-2">
          <div
            className={[
              headerOffsetClassName ?? "ml-14 sm:ml-16 lg:ml-0",
              "flex min-h-14 flex-wrap items-center gap-3",
            ].join(" ")}
          >
            {showBackButton && onBack && (
              <Button variant="ghost" size="sm" onClick={onBack}>
                ← Back
              </Button>
            )}
            <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate">
              {config.name}
            </h1>
            <button
              onClick={() => setRenameModal(true)}
              className="flex-shrink-0 p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-neutral-700"
              aria-label={`Rename ${labels.singular}`}
              title={`Rename ${labels.singular}`}
            >
              <EditIcon />
            </button>
            <Badge variant={isPlanning ? (isPlanReady ? "plan_ready" : "planning") : getStatusBadgeVariant(state.status)} size="sm">
              {isPlanning ? getPlanningStatusLabel(isPlanReady) : getStatusLabel(state.status, state.syncState)}
            </Badge>
            <span className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate hidden sm:inline">
              {config.directory}
            </span>
          </div>
        </div>
      </header>

      <main className="px-4 sm:px-6 lg:px-8 py-3 flex flex-col flex-1 min-h-0 overflow-hidden">
        {/* Error display - from hook */}
        {error && (
          <div className="mb-3 rounded-md bg-red-50 dark:bg-red-900/20 p-3 flex-shrink-0">
            <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* Loop error display - from loop.state.error */}
        {state.error && (
          <div className="mb-3 rounded-md bg-red-50 dark:bg-red-900/20 p-3 flex-shrink-0 border border-red-200 dark:border-red-800">
            <div className="flex items-start gap-2">
              <div className="flex-shrink-0 text-red-600 dark:text-red-400">
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium text-red-800 dark:text-red-300">{labels.capitalized} Error</h3>
                <p className="mt-1 text-sm text-red-700 dark:text-red-400 break-words">{state.error.message}</p>
                <div className="mt-2 text-xs text-red-600 dark:text-red-500">
                  <span className="mr-3">Iteration: {state.error.iteration}</span>
                  {state.error.timestamp && (
                    <span>Time: {formatDateTime(state.error.timestamp)}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Full width content area */}
        <div className="flex min-w-0 flex-1 min-h-0 flex-col overflow-hidden">
              <div className="flex min-w-0 flex-1 min-h-0 flex-col overflow-hidden">
                {/* Tab navigation */}
                <div className="flex border-b border-gray-200 dark:border-gray-700 mb-3 overflow-x-auto flex-shrink-0">
                  {visibleTabs.map((tab) => {
                    const hasUpdate = tabsWithUpdates.has(tab.id);
                    const showPlanWritingIndicator = tab.id === "plan" && isPlanning && !isPlanReady && activeTab !== "plan";
                    return (
                      <button
                        key={tab.id}
                        onClick={() => handleTabChange(tab.id)}
                        className={`relative px-1.5 sm:px-4 py-1.5 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                          activeTab === tab.id
                            ? "border-gray-900 text-gray-900 dark:border-gray-100 dark:text-gray-100"
                            : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                        }`}
                      >
                        <span className="flex items-center gap-1.5">
                          {tab.label}
                          {showPlanWritingIndicator && (
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-gray-500 opacity-75" />
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-gray-600" />
                            </span>
                          )}
                        </span>
                        {hasUpdate && !showPlanWritingIndicator && activeTab !== tab.id && (
                          <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-gray-500" />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Tab content */}
                <div className="flex min-w-0 flex-1 min-h-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-neutral-800">
                  {activeTab === "log" && (
                    <LogTab
                      messages={messages}
                      toolCalls={toolCalls}
                      logs={logs}
                      todos={todos}
                      showSystemInfo={showSystemInfo}
                      onShowSystemInfoChange={setShowSystemInfo}
                      showReasoning={showReasoning}
                      onShowReasoningChange={setShowReasoning}
                      showTools={showTools}
                      onShowToolsChange={setShowTools}
                      autoScroll={autoScroll}
                      onAutoScrollChange={setAutoScroll}
                      logsCollapsed={logsCollapsed}
                      onLogsCollapsedChange={setLogsCollapsed}
                      todosCollapsed={todosCollapsed}
                      onTodosCollapsedChange={setTodosCollapsed}
                      markdownEnabled={markdownEnabled}
                      isLogActive={isLogActive}
                      pendingPlanQuestion={pendingPlanQuestion}
                      planQuestionSelections={planQuestionSelections}
                      onPlanQuestionSelectionsChange={setPlanQuestionSelections}
                      planQuestionCustomAnswers={planQuestionCustomAnswers}
                      onPlanQuestionCustomAnswersChange={setPlanQuestionCustomAnswers}
                      planQuestionSubmitting={planQuestionSubmitting}
                      onAnswerPlanQuestion={handleAnswerPlanQuestion}
                    />
                  )}
                  {activeTab === "info" && (
                    <InfoTab
                      loop={loop}
                      labels={labels}
                      sshConnecting={sshConnecting}
                      onConnectViaSsh={handleConnectViaSsh}
                      newForwardPort={newForwardPort}
                      onNewForwardPortChange={setNewForwardPort}
                      creatingForward={creatingForward}
                      onCreateForward={handleCreateForward}
                      forwards={forwards}
                      forwardsLoading={forwardsLoading}
                      forwardsError={forwardsError}
                      onOpenForward={handleOpenForward}
                      onCopyForwardUrl={handleCopyForwardUrl}
                      onDeleteForward={handleDeleteForward}
                      loopId={loopId}
                    />
                  )}
                  {activeTab === "prompt" && (
                    <PromptTab
                      config={config}
                      state={state}
                      labels={labels}
                      isActive={isActive}
                    />
                  )}
                  {activeTab === "plan" && (
                    <PlanTab
                      isPlanning={isPlanning}
                      isPlanReady={isPlanReady}
                      feedbackRounds={feedbackRounds}
                      planContent={planContent}
                      loadingContent={loadingContent}
                      markdownEnabled={markdownEnabled}
                    />
                  )}
                  {activeTab === "status" && (
                    <StatusTab
                      statusContent={statusContent}
                      loadingContent={loadingContent}
                      markdownEnabled={markdownEnabled}
                    />
                  )}
                  {activeTab === "diff" && (
                    <DiffTab
                      diffContent={diffContent}
                      loadingContent={loadingContent}
                      expandedFiles={expandedFiles}
                      onExpandedFilesChange={setExpandedFiles}
                    />
                  )}
                  {activeTab === "review" && (
                    <ReviewTab
                      loop={loop}
                      labels={labels}
                      loadingComments={loadingComments}
                      reviewComments={reviewComments}
                    />
                  )}
                  {activeTab === "actions" && (
                    <ActionsTab
                      isPlanning={isPlanning}
                      isPlanReady={isPlanReady}
                      planContent={planContent}
                      planActionSubmitting={planActionSubmitting}
                      onAcceptPlan={handleAcceptPlan}
                      onDiscardPlanModal={() => setDiscardPlanModal(true)}
                      state={state}
                      loadingPullRequestDestination={loadingPullRequestDestination}
                      pullRequestDestination={pullRequestDestination}
                      onOpenPullRequest={handleOpenPullRequest}
                      onAddressCommentsModal={() => setAddressCommentsModal(true)}
                      onUpdateBranchModal={() => setUpdateBranchModal(true)}
                      onMarkMergedModal={() => setMarkMergedModal(true)}
                      onPurgeModal={() => setPurgeModal(true)}
                      onAcceptModal={() => setAcceptModal(true)}
                      onDeleteModal={() => setDeleteModal(true)}
                      labels={labels}
                    />
                  )}
                </div>
              </div>
        </div>
      </main>

      {/* LoopActionBar for active messaging plus terminal-state restarts */}
      {(isActive || isPlanning || canTerminalFollowUp) && (
        <LoopActionBar
          mode={config.mode}
          isPlanning={isPlanning}
          currentModel={config.model}
          pendingModel={state.pendingModel}
          pendingPrompt={state.pendingPrompt}
          models={models}
          modelsLoading={modelsLoading}
          requireMessage={canTerminalFollowUp}
          submitLabel={canTerminalFollowUp ? (isChatMode ? "Send" : "Restart") : undefined}
          helperText={canTerminalFollowUp
            ? "Message will start a new feedback cycle immediately. Model change takes effect on that cycle."
            : undefined}
          onQueuePending={async (options) => {
            if (isPlanning) {
              // In planning mode, send feedback on the plan
              if (options.message) {
                await sendPlanFeedback(options.message);
                return true;
              }
              return false;
            }
            if (canTerminalFollowUp) {
              if (options.message) {
                return await sendFollowUp(options.message, options.model);
              }
              return false;
            }
            if (isChatMode) {
              // In chat mode, send message immediately via chat API
              if (options.message) {
                return await sendChatMessage(options.message, options.model);
              }
              return false;
            }
            // In loop mode, queue for next iteration
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

      {/* Update Branch confirmation modal */}
      <UpdateBranchModal
        isOpen={updateBranchModal}
        onClose={() => setUpdateBranchModal(false)}
        onUpdateBranch={handleUpdateBranch}
      />

      {/* Address Comments modal */}
      <AddressCommentsModal
        isOpen={addressCommentsModal}
        onClose={() => setAddressCommentsModal(false)}
        onSubmit={handleAddressComments}
        loopName={config.name}
        reviewCycle={(state.reviewMode?.reviewCycles || 0) + 1}
      />

      {/* Rename Loop modal */}
      <RenameLoopModal
        isOpen={renameModal}
        onClose={() => setRenameModal(false)}
        currentName={config.name}
        onRename={async (newName) => {
          await update({ name: newName });
        }}
      />

      {/* Discard Plan confirmation modal */}
      <ConfirmModal
        isOpen={discardPlanModal}
        onClose={() => setDiscardPlanModal(false)}
        onConfirm={handleDiscardPlan}
        title="Discard Plan?"
        message="Are you sure you want to discard this plan? This will delete the loop and all planning work will be lost."
        confirmLabel={planActionSubmitting ? "Discarding..." : "Discard"}
        cancelLabel="Cancel"
        loading={planActionSubmitting}
        variant="danger"
      />
    </div>
  );
}

export default LoopDetails;
