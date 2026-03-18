/**
 * CreateLoopForm component for creating new Ralph Loops.
 */

import { useState, useEffect, useRef, useCallback, type FormEvent, type ReactNode } from "react";
import type { CreateLoopRequest, CreateChatRequest, ModelInfo, BranchInfo, SshServer } from "../types";
import type { Workspace } from "../types/workspace";
import { DEFAULT_LOOP_CONFIG } from "../types/loop";
import { Button } from "./common";
import { WorkspaceSelector } from "./WorkspaceSelector";
import { ModelSelector, makeModelKey, parseModelKey, isModelEnabled, modelVariantExists, groupModelsByProvider } from "./ModelSelector";
import { createLogger } from "../lib/logger";
import { PROMPT_TEMPLATES, getTemplateById } from "../lib/prompt-templates";
import { useToast } from "../hooks";
import { generateLoopTitleApi } from "../hooks/loopActions";

// Create a named logger for this component
const log = createLogger("CreateLoopForm");

/** State for action buttons, exposed via renderActions prop */
export interface CreateLoopFormActionState {
  /** Whether the form is currently submitting */
  isSubmitting: boolean;
  /** Whether the form can be submitted to start a loop (has required fields AND model is enabled) */
  canSubmit: boolean;
  /** Whether the form can be saved as a draft (has required fields, model can be disconnected) */
  canSaveDraft: boolean;
  /** Whether we're editing an existing loop */
  isEditing: boolean;
  /** Whether we're editing a draft loop */
  isEditingDraft: boolean;
  /** Whether plan mode is enabled */
  planMode: boolean;
  /** Handler for cancel button */
  onCancel: () => void;
  /** Handler for submit button (creates/starts the loop) */
  onSubmit: () => void;
  /** Handler for save as draft button */
  onSaveAsDraft: () => void;
}

export interface CreateLoopFormProps {
  /** Callback when form is submitted. Returns true if successful, false otherwise. */
  onSubmit: (request: CreateLoopFormSubmitRequest) => Promise<boolean>;
  /** Callback when form is cancelled */
  onCancel: () => void;
  /** Whether to call onCancel after a successful submit */
  closeOnSuccess?: boolean;
  /** Whether form is submitting */
  loading?: boolean;
  /** Available models */
  models?: ModelInfo[];
  /** Loading models */
  modelsLoading?: boolean;
  /** Last used model (includes variant) */
  lastModel?: { providerID: string; modelID: string; variant?: string } | null;
  /** Callback when workspace changes (to reload models and branches) */
  onWorkspaceChange?: (workspaceId: string | null, directory: string) => void;
  /** Warning about .planning directory */
  planningWarning?: string | null;
  /** Available branches for the workspace's directory */
  branches?: BranchInfo[];
  /** Whether branches are loading */
  branchesLoading?: boolean;
  /** Current branch name */
  currentBranch?: string;
  /** Default branch name (e.g., "main" or "master") */
  defaultBranch?: string;
  /** Loop ID if editing an existing draft */
  editLoopId?: string | null;
  /** Initial loop data for editing */
  initialLoopData?: {
    name?: string;
    directory: string;
    prompt: string;
    model?: { providerID: string; modelID: string; variant?: string };
    maxIterations?: number;
    maxConsecutiveErrors?: number;
    activityTimeoutSeconds?: number;
    baseBranch?: string;
    useWorktree?: boolean;
    clearPlanningFolder?: boolean;
    planMode?: boolean;
    planModeAutoReply?: boolean;
    workspaceId?: string;
  } | null;
  /** Whether editing a draft loop (to show Update Draft button) */
  isEditingDraft?: boolean;
  /** Available workspaces */
  workspaces?: Workspace[];
  /** Whether workspaces are loading */
  workspacesLoading?: boolean;
  /** Workspace-related error */
  workspaceError?: string | null;
  /** Registered SSH servers for workspace label resolution */
  registeredSshServers?: readonly SshServer[];
  /** 
   * Optional render prop for action buttons. When provided, action buttons 
   * are NOT rendered inside the form - caller is responsible for rendering them.
   * This is useful for rendering actions in a Modal footer (sticky position).
   */
  renderActions?: (state: CreateLoopFormActionState) => void;
  /** Optional extra actions rendered beside the draft/save action group. */
  leadingActions?: ReactNode;
  /** Mode: "loop" (default) or "chat" — controls which fields are shown */
  mode?: "loop" | "chat";
}

export type CreateLoopFormSubmitRequest = CreateLoopRequest | CreateChatRequest;

export function CreateLoopForm({
  onSubmit,
  onCancel,
  closeOnSuccess = true,
  loading = false,
  models = [],
  modelsLoading = false,
  lastModel,
  onWorkspaceChange,
  planningWarning,
  branches = [],
  branchesLoading = false,
  currentBranch = "",
  defaultBranch = "",
  editLoopId = null,
  initialLoopData = null,
  isEditingDraft = false,
  workspaces = [],
  workspacesLoading = false,
  workspaceError = null,
  registeredSshServers = [],
  renderActions,
  leadingActions,
  mode = "loop",
}: CreateLoopFormProps) {
  const isEditing = !!editLoopId;
  const isChatMode = mode === "chat";
  const toast = useToast();
  
  // Track if this is the first render to prevent infinite loops
  const isInitialMount = useRef(true);
  
  // Refs track the latest form text values so submit callbacks passed through
  // renderActions can always read current input without needing to recreate the callbacks.
  const nameRef = useRef(initialLoopData?.name ?? "");
  const promptRef = useRef(initialLoopData?.prompt ?? "");
  
  // Workspace state - the only source of truth for directory
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | undefined>(
    initialLoopData?.workspaceId
  );
  const [selectedWorkspaceDirectory, setSelectedWorkspaceDirectory] = useState<string>(
    initialLoopData?.directory ?? ""
  );
  
  const [name, setName] = useState(initialLoopData?.name ?? "");
  const [prompt, setPrompt] = useState(initialLoopData?.prompt ?? "");
  const [maxIterations, setMaxIterations] = useState<string>(initialLoopData?.maxIterations?.toString() ?? "");
  const [maxConsecutiveErrors, setMaxConsecutiveErrors] = useState<string>(initialLoopData?.maxConsecutiveErrors?.toString() ?? "10");
  const [activityTimeoutSeconds, setActivityTimeoutSeconds] = useState<string>(initialLoopData?.activityTimeoutSeconds?.toString() ?? String(DEFAULT_LOOP_CONFIG.activityTimeoutSeconds));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [selectedBranch, setSelectedBranch] = useState<string>(initialLoopData?.baseBranch ?? "");
  // Track whether user has manually changed the branch selection
  const [userChangedBranch, setUserChangedBranch] = useState(!!initialLoopData?.baseBranch);
  const [useWorktree, setUseWorktree] = useState(initialLoopData?.useWorktree ?? DEFAULT_LOOP_CONFIG.useWorktree);
  const [clearPlanningFolder, setClearPlanningFolder] = useState(initialLoopData?.clearPlanningFolder ?? false);
  const [planMode, setPlanMode] = useState(initialLoopData?.planMode ?? true);
  const [planModeAutoReply, setPlanModeAutoReply] = useState(initialLoopData?.planModeAutoReply ?? DEFAULT_LOOP_CONFIG.planModeAutoReply);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [generatingTitle, setGeneratingTitle] = useState(false);

  // Sync prompt state when initialLoopData changes (safety measure for component reuse)
  // This handles both editing a draft (set to draft's prompt) and switching to create mode (reset to empty)
  useEffect(() => {
    const newPrompt = initialLoopData?.prompt ?? "";
    log.debug('Syncing prompt from initialLoopData', { 
      promptLength: newPrompt.length,
      promptPreview: newPrompt.slice(0, 50),
      hasInitialLoopData: !!initialLoopData
    });
    setPrompt(newPrompt);
    promptRef.current = newPrompt;
  }, [initialLoopData?.prompt]);

  useEffect(() => {
    setName(initialLoopData?.name ?? "");
    nameRef.current = initialLoopData?.name ?? "";
  }, [initialLoopData?.name]);

  useEffect(() => {
    setSelectedWorkspaceId(initialLoopData?.workspaceId);
    setSelectedWorkspaceDirectory(initialLoopData?.directory ?? "");
  }, [initialLoopData?.workspaceId, initialLoopData?.directory]);

  // Check if the selected model is enabled (connected)
  const selectedModelEnabled = selectedModel ? isModelEnabled(models, selectedModel) : false;

  // Reset selected branch when default branch changes (directory changed)
  useEffect(() => {
    log.debug('useEffect 1 - branch reset', { defaultBranch, userChangedBranch, isEditing });
    // Only set default branch if:
    // 1. We have a default branch from the server
    // 2. User hasn't manually changed the branch
    // 3. Not editing an existing loop (for edits, use the stored baseBranch)
    if (defaultBranch && !userChangedBranch && !isEditing) {
      log.debug('Setting selected branch to:', defaultBranch);
      setSelectedBranch(defaultBranch);
    }
  }, [defaultBranch, userChangedBranch, isEditing]);

  // Set initial model when lastModel, models, or initialLoopData change
  useEffect(() => {
    log.debug('useEffect 2 - model selection', { 
      selectedModel, 
      lastModel, 
      modelsCount: models.length,
      initialLoopDataModel: initialLoopData?.model 
    });
    if (selectedModel) return; // Don't override if user already selected

    // If editing and initial loop data has a model, use that
    if (initialLoopData?.model && models.length > 0) {
      const variant = initialLoopData.model.variant ?? "";
      if (modelVariantExists(models, initialLoopData.model.providerID, initialLoopData.model.modelID, variant)) {
        const modelKey = makeModelKey(initialLoopData.model.providerID, initialLoopData.model.modelID, variant);
        log.debug('Setting model from initialLoopData:', modelKey);
        setSelectedModel(modelKey);
        return;
      }
    }

    // Otherwise, try lastModel
    if (lastModel && models.length > 0) {
      const variant = lastModel.variant ?? "";
      if (modelVariantExists(models, lastModel.providerID, lastModel.modelID, variant)) {
        const modelKey = makeModelKey(lastModel.providerID, lastModel.modelID, variant);
        log.debug('Setting model from lastModel:', modelKey);
        setSelectedModel(modelKey);
        return;
      }
    }

    // Default to first connected model (with first variant or empty variant)
    const firstConnected = models.find((m) => m.connected);
    if (firstConnected) {
      // Use first variant if available, otherwise empty string
      const variant = firstConnected.variants && firstConnected.variants.length > 0 
        ? firstConnected.variants[0] 
        : "";
      const modelKey = makeModelKey(firstConnected.providerID, firstConnected.modelID, variant);
      log.debug('Setting model to first connected:', modelKey);
      setSelectedModel(modelKey);
    }
  }, [lastModel, models, selectedModel, initialLoopData]);

  // Notify parent when workspace changes
  // This triggers fetching models, branches, and checking planning dir
  useEffect(() => {
    log.debug('useEffect 3 - workspace change', { 
      selectedWorkspaceId,
      selectedWorkspaceDirectory,
      isInitialMount: isInitialMount.current,
      hasOnWorkspaceChange: !!onWorkspaceChange 
    });
    // Skip on initial mount to prevent calling with initial value
    if (isInitialMount.current) {
      isInitialMount.current = false;
      // But DO call on initial mount if we have initial data (editing mode)
      if (initialLoopData?.workspaceId && initialLoopData?.directory && onWorkspaceChange) {
        log.debug('Initial call to onWorkspaceChange:', initialLoopData.workspaceId, initialLoopData.directory);
        onWorkspaceChange(initialLoopData.workspaceId, initialLoopData.directory);
      }
      return;
    }
    
    if (!onWorkspaceChange) return;
    
    log.debug('Calling onWorkspaceChange:', selectedWorkspaceId, selectedWorkspaceDirectory);
    // Notify parent of workspace change (including null for no selection)
    onWorkspaceChange(selectedWorkspaceId ?? null, selectedWorkspaceDirectory);
    // Note: onWorkspaceChange is intentionally NOT in deps array to prevent infinite loop
    // The callback itself changing should not retrigger this effect
    // Note: We use primitive values (workspaceId, directory) instead of initialLoopData object
    // to avoid re-running when initialLoopData gets a new object reference
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkspaceId, selectedWorkspaceDirectory, initialLoopData?.workspaceId, initialLoopData?.directory]);
  
  // Reset branch selection flag when workspace changes (separate effect to avoid loop)
  useEffect(() => {
    log.debug('useEffect 4 - reset userChangedBranch', { 
      isEditing, 
      isInitialMount: isInitialMount.current,
      selectedWorkspaceId 
    });
    if (!isEditing && !isInitialMount.current) {
      log.debug('Resetting userChangedBranch to false');
      setUserChangedBranch(false);
    }
  }, [selectedWorkspaceId, isEditing]);

  const handleSubmit = useCallback(async (e: FormEvent, asDraft = false) => {
    e.preventDefault();

    // Read the current prompt from ref to avoid stale closures
    // This ensures we get the actual current value even if the callback
    // reference wasn't updated (e.g., when passed via renderActions to parent)
    const currentName = nameRef.current;
    const currentPrompt = promptRef.current;

    // Debug logging for form submission
    log.debug('handleSubmit - Form state', { 
      asDraft,
      promptLength: currentPrompt.length,
      promptPreview: currentPrompt.slice(0, 50),
      selectedWorkspaceId,
    });

    // Workspace selection is required
    if (!selectedWorkspaceId) {
      return;
    }
    if (!currentPrompt.trim()) {
      return;
    }
    if (!isChatMode && !currentName.trim()) {
      return;
    }
    
    // Validate model is enabled if selected (required for all submissions including drafts)
    if (!selectedModel || !selectedModelEnabled) {
      return;
    }

    setSubmitting(true);

    // Parse model from selectedModel string
    const parsedModel = parseModelKey(selectedModel);
    if (!parsedModel) {
      setSubmitting(false);
      return;
    }

    const model = {
      providerID: parsedModel.providerID,
      modelID: parsedModel.modelID,
      variant: parsedModel.variant,
    };

    let request: CreateLoopFormSubmitRequest;

    if (isChatMode) {
      const chatRequest: CreateChatRequest = {
        workspaceId: selectedWorkspaceId,
        prompt: currentPrompt.trim(),
        model,
        useWorktree,
      };

      if (selectedBranch && selectedBranch !== currentBranch) {
        chatRequest.baseBranch = selectedBranch;
      }

      request = chatRequest;
    } else {
      const loopRequest: CreateLoopRequest = {
        name: currentName.trim(),
        workspaceId: selectedWorkspaceId,
        prompt: currentPrompt.trim(),
        planMode,
        planModeAutoReply,
        model,
        useWorktree,
      };

      if (maxIterations.trim()) {
        const num = parseInt(maxIterations, 10);
        if (!isNaN(num) && num > 0) {
          loopRequest.maxIterations = num;
        }
      }

      if (maxConsecutiveErrors.trim()) {
        const num = parseInt(maxConsecutiveErrors, 10);
        if (!isNaN(num) && num >= 0) {
          loopRequest.maxConsecutiveErrors = num === 0 ? 0 : num;
        }
      }

      if (activityTimeoutSeconds.trim()) {
        const num = parseInt(activityTimeoutSeconds, 10);
        if (!isNaN(num) && num >= 60) {
          loopRequest.activityTimeoutSeconds = num;
        }
      }

      if (selectedBranch && selectedBranch !== currentBranch) {
        loopRequest.baseBranch = selectedBranch;
      }

      loopRequest.clearPlanningFolder = clearPlanningFolder;
      loopRequest.planMode = planMode;

      if (asDraft) {
        loopRequest.draft = true;
      }

      request = loopRequest;
    }

    try {
      const success = await onSubmit(request);
      if (success && closeOnSuccess) {
        onCancel();
      }
    } catch (error) {
      // Keep form open on error so user can retry
      log.error("Failed to create loop:", error);
    } finally {
      setSubmitting(false);
    }
    // Note: onSubmit and onCancel are intentionally NOT in deps
    // They are callbacks from parent and shouldn't trigger recreation
    // Note: prompt and name are NOT in deps because we read from promptRef.current
    // and nameRef.current instead of capturing potentially stale state values.
    // This avoids stale closures when callbacks are passed to parent via renderActions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedWorkspaceId,
    selectedModel,
    selectedModelEnabled,
    isChatMode,
    planMode,
    planModeAutoReply,
    maxIterations,
    maxConsecutiveErrors,
    activityTimeoutSeconds,
    selectedBranch,
    currentBranch,
    clearPlanningFolder,
    useWorktree,
  ]);

  const isSubmitting = loading || submitting;

  // Form ref for programmatic submission
  const formRef = useRef<HTMLFormElement>(null);
  const cancelActionRef = useRef(onCancel);
  const submitActionRef = useRef<() => void>(() => {});
  const saveAsDraftActionRef = useRef<() => void>(() => {});
  
  // Check if form can be saved as a draft (basic fields only, model connectivity not required)
  const canSaveDraft = !isChatMode && !!selectedWorkspaceId && !!prompt.trim() && !!name.trim();
  
  // Check if form can be submitted to start a loop (also needs model to be enabled)
  const canSubmit = !!selectedWorkspaceId && !!prompt.trim() && (isChatMode || !!name.trim()) && selectedModelEnabled;

  const canGenerateTitle = !isChatMode && !!selectedWorkspaceId && !!prompt.trim() && !isSubmitting && !generatingTitle;
  
  // Handler for submit button click (when rendered externally)
  const handleSubmitClick = useCallback(() => {
    if (formRef.current) {
      formRef.current.requestSubmit();
    }
  }, []);
  
  // Handler for save as draft click (when rendered externally)
  const handleSaveAsDraftClick = useCallback(() => {
    if (formRef.current && canSaveDraft) {
      // Create a synthetic event and call handleSubmit with draft flag
      const syntheticEvent = { preventDefault: () => {} } as FormEvent;
      handleSubmit(syntheticEvent, true);
    }
  }, [canSaveDraft, handleSubmit]);

  useEffect(() => {
    cancelActionRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    submitActionRef.current = handleSubmitClick;
  }, [handleSubmitClick]);

  useEffect(() => {
    saveAsDraftActionRef.current = handleSaveAsDraftClick;
  }, [handleSaveAsDraftClick]);

  const handleExternalCancel = useCallback(() => {
    cancelActionRef.current();
  }, []);

  const handleExternalSubmit = useCallback(() => {
    submitActionRef.current();
  }, []);

  const handleExternalSaveAsDraft = useCallback(() => {
    saveAsDraftActionRef.current();
  }, []);
  
  // Call renderActions whenever action state changes
  const renderActionsRef = useRef<{
    isSubmitting?: boolean;
    canSubmit?: boolean;
    canSaveDraft?: boolean;
    isEditing?: boolean;
    isEditingDraft?: boolean;
    planMode?: boolean;
  }>({});
  
  useEffect(() => {
    const prev = renderActionsRef.current;
    log.debug('useEffect 5 - renderActions deps changed:', {
      isSubmitting: isSubmitting !== prev.isSubmitting,
      canSubmit: canSubmit !== prev.canSubmit,
      canSaveDraft: canSaveDraft !== prev.canSaveDraft,
      isEditing: isEditing !== prev.isEditing,
      isEditingDraft: isEditingDraft !== prev.isEditingDraft,
      planMode: planMode !== prev.planMode,
    });
    
    renderActionsRef.current = {
      isSubmitting,
      canSubmit,
      canSaveDraft,
      isEditing,
      isEditingDraft,
      planMode,
    };
    
    if (renderActions) {
      renderActions({
        isSubmitting,
        canSubmit,
        canSaveDraft,
        isEditing,
        isEditingDraft,
        planMode,
        onCancel: handleExternalCancel,
        onSubmit: handleExternalSubmit,
        onSaveAsDraft: handleExternalSaveAsDraft,
      });
    }
    // Note: renderActions is intentionally NOT in deps. We only want to notify
    // parent layouts when the actual action state changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSubmitting, canSubmit, canSaveDraft, isEditing, isEditingDraft, planMode]);

  // Handle workspace selection - stores both workspaceId and directory
  function handleWorkspaceSelect(workspaceId: string | null, workspaceDirectory: string) {
    setSelectedWorkspaceId(workspaceId || undefined);
    setSelectedWorkspaceDirectory(workspaceDirectory);
    // The useEffect watching selectedWorkspaceId will notify parent
  }

  const handleGenerateTitle = useCallback(async () => {
    if (!selectedWorkspaceId || !promptRef.current.trim()) {
      return;
    }

    setGeneratingTitle(true);
    try {
      const generatedTitle = await generateLoopTitleApi({
        workspaceId: selectedWorkspaceId,
        prompt: promptRef.current.trim(),
      });
      setName(generatedTitle);
      nameRef.current = generatedTitle;
    } catch (error) {
      log.error("Failed to generate loop title:", error);
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setGeneratingTitle(false);
    }
  }, [selectedWorkspaceId, toast]);

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
      {/* Workspace Selection */}
      <div>
        <WorkspaceSelector
          workspaces={workspaces}
          loading={workspacesLoading}
          selectedWorkspaceId={selectedWorkspaceId}
          onSelect={handleWorkspaceSelect}
          error={workspaceError}
          registeredSshServers={registeredSshServers}
        />
        {planningWarning && !planMode && !isChatMode && (
          <div className="mt-2 flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-300">
            <svg
              className="h-5 w-5 flex-shrink-0 text-amber-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <span>{planningWarning}</span>
          </div>
        )}
      </div>

      {/* Base Branch Selection */}
      <div>
        <label
          htmlFor="branch"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Base Branch
        </label>
        <select
          id="branch"
          value={selectedBranch}
          onChange={(e) => {
            setSelectedBranch(e.target.value);
            setUserChangedBranch(true);
          }}
          disabled={branchesLoading || branches.length === 0}
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:border-gray-600 dark:bg-neutral-700 dark:text-gray-100 dark:focus:ring-gray-600 disabled:opacity-50 font-mono text-sm"
        >
          {branchesLoading && (
            <option value="">Loading branches...</option>
          )}
          {!branchesLoading && branches.length === 0 && (
            <option value="">Select a workspace to load branches</option>
          )}
          {!branchesLoading && branches.length > 0 && (
            <>
              {/* Default branch first (with label) */}
              {defaultBranch && (
                <option value={defaultBranch}>
                  {defaultBranch} (default){defaultBranch === currentBranch ? " (current)" : ""}
                </option>
              )}
              {/* Current branch if different from default */}
              {currentBranch && currentBranch !== defaultBranch && (
                <option value={currentBranch}>
                  {currentBranch} (current)
                </option>
              )}
              {/* Separator if we have special branches */}
              {(defaultBranch || currentBranch) && branches.length > 1 && (
                <option disabled>──────────</option>
              )}
              {/* Other branches sorted by name (excluding default and current) */}
              {branches
                .filter((b) => b.name !== defaultBranch && b.name !== currentBranch)
                .map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                  </option>
                ))}
            </>
          )}
        </select>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Branch to base the loop on (default: repository's default branch)
        </p>
      </div>

      {/* Model Selection */}
      <div>
        <label
          htmlFor="model"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Model
        </label>
        <ModelSelector
          id="model"
          value={selectedModel}
          onChange={setSelectedModel}
          models={models}
          loading={modelsLoading}
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:border-gray-600 dark:bg-neutral-700 dark:text-gray-100 dark:focus:ring-gray-600 disabled:opacity-50"
        />
        {!modelsLoading && models.length > 0 && groupModelsByProvider(models).connectedProviders.length === 0 && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            No providers are connected. Please configure your agent backend credentials/settings.
          </p>
        )}
        {!modelsLoading && models.length > 0 && groupModelsByProvider(models).connectedProviders.length > 0 && !selectedModel && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            Model is required. Please select a model.
          </p>
        )}
      </div>

      {/* Prompt Template — hidden in chat mode */}
      {!isChatMode && (
      <div>
        <label
          htmlFor="template"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Template
        </label>
        <select
          id="template"
          value={selectedTemplate}
          onChange={(e) => {
            const templateId = e.target.value;
            setSelectedTemplate(templateId);
            if (templateId) {
              const template = getTemplateById(templateId);
              if (template) {
                setPrompt(template.prompt);
                promptRef.current = template.prompt;
                if (template.defaults?.planMode !== undefined) {
                  setPlanMode(template.defaults.planMode);
                }
              }
            }
          }}
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:border-gray-600 dark:bg-neutral-700 dark:text-gray-100 dark:focus:ring-gray-600"
        >
          <option value="">No template (custom prompt)</option>
          {PROMPT_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {selectedTemplate && (() => {
          const t = getTemplateById(selectedTemplate);
          return t ? (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t.description}
            </p>
          ) : null;
        })()}
      </div>
      )}

      {!isChatMode && (
        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Title <span className="text-red-500">*</span>
          </label>
          <div className="mt-1 flex items-start gap-2">
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => {
                const newValue = e.target.value;
                setName(newValue);
                nameRef.current = newValue;
              }}
              placeholder="Short loop title"
              required
              maxLength={100}
              className="block flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:border-gray-600 dark:bg-neutral-700 dark:text-gray-100 dark:focus:ring-gray-600"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void handleGenerateTitle()}
              disabled={!canGenerateTitle}
              loading={generatingTitle}
              icon={<TitleSparkIcon className="h-4 w-4" />}
              aria-label="Generate title with AI"
              title="Generate title with AI"
              className="shrink-0 px-2"
            >
              {null}
            </Button>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Give the loop a clear title, or use AI to suggest one from the current prompt.
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {name.trim().length}/100 characters
          </p>
        </div>
      )}

      {/* Prompt */}
      <div>
        <label
          htmlFor="prompt"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {isChatMode ? "Message" : "Prompt"} <span className="text-red-500">*</span>
        </label>
        <textarea
          id="prompt"
          value={prompt}
          onChange={(e) => {
            const newValue = e.target.value;
            setPrompt(newValue);
            promptRef.current = newValue;
            // Reset template selection if user edits the prompt away from the template text
            if (selectedTemplate) {
              const template = getTemplateById(selectedTemplate);
              if (template && newValue !== template.prompt) {
                setSelectedTemplate("");
              }
            }
          }}
          placeholder={isChatMode ? "Ask a question or describe what you want to do..." : (planMode ? "Describe what you want to achieve. The AI will create a detailed plan based on this." : "Do everything that's pending in the plan")}
          required
          rows={3}
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:border-gray-600 dark:bg-neutral-700 dark:text-gray-100 dark:focus:ring-gray-600 min-h-[76px] sm:min-h-[120px] resize-y"
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {isChatMode ? "Your first message to start the conversation" : "The prompt sent to the AI agent at the start of each iteration"}
        </p>
      </div>

      {/* Plan Mode Toggle — hidden in chat mode */}
      {!isChatMode && (
      <div>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={planMode}
            onChange={(e) => setPlanMode(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-gray-300 text-gray-700 focus:ring-gray-500 dark:border-gray-600 dark:bg-neutral-700 dark:text-gray-300"
          />
          <div className="flex-1">
            <span className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Plan Mode
            </span>
            {/* Short description on mobile, full description on desktop */}
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 sm:hidden">
              Review AI plan before execution
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 hidden sm:block">
              Create and review a plan before starting the loop. The AI will generate a plan based on your prompt, and you can provide feedback before execution begins.
            </p>
          </div>
        </label>
      </div>
      )}

      {!isChatMode && planMode && (
      <div className="ml-7">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={planModeAutoReply}
            onChange={(e) => setPlanModeAutoReply(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-gray-300 text-gray-700 focus:ring-gray-500 dark:border-gray-600 dark:bg-neutral-700 dark:text-gray-300"
          />
          <div className="flex-1">
            <span className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Auto-reply plan questions
            </span>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Enabled by default. Turn this off to answer plan-mode questions yourself below the execution log.
            </p>
          </div>
        </label>
      </div>
      )}

      <div>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={useWorktree}
            onChange={(e) => setUseWorktree(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-gray-300 text-gray-700 focus:ring-gray-500 dark:border-gray-600 dark:bg-neutral-700 dark:text-gray-300"
          />
          <div className="flex-1">
            <span className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Use Worktree
            </span>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Run in a dedicated Ralph worktree. Turn this off to use the main checkout with a dedicated Ralph branch.
            </p>
          </div>
        </label>
      </div>

      {/* Advanced options toggle — hidden in chat mode */}
      {!isChatMode && (
      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="text-sm text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-gray-100"
      >
        {showAdvanced ? "Hide" : "Show"} advanced options
      </button>
      )}

      {/* Advanced options — hidden in chat mode */}
      {!isChatMode && showAdvanced && (
        <div className="space-y-4 p-4 bg-gray-50 dark:bg-neutral-800 rounded-md">
          {/* Max iterations */}
          <div>
            <label
              htmlFor="maxIterations"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Max Iterations
            </label>
            <input
              type="number"
              id="maxIterations"
              value={maxIterations}
              onChange={(e) => setMaxIterations(e.target.value)}
              min="1"
              placeholder="Unlimited"
              className="mt-1 block w-32 rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:border-gray-600 dark:bg-neutral-700 dark:text-gray-100 dark:focus:ring-gray-600"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Leave empty for unlimited iterations
            </p>
          </div>

          {/* Max consecutive errors */}
          <div>
            <label
              htmlFor="maxConsecutiveErrors"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Max Consecutive Errors
            </label>
            <input
              type="number"
              id="maxConsecutiveErrors"
              value={maxConsecutiveErrors}
              onChange={(e) => setMaxConsecutiveErrors(e.target.value)}
              min="0"
              placeholder="10"
              className="mt-1 block w-32 rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:border-gray-600 dark:bg-neutral-700 dark:text-gray-100 dark:focus:ring-gray-600"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Failsafe exit after this many identical consecutive errors. 0 = unlimited. (default: 10)
            </p>
          </div>

          {/* Activity timeout */}
          <div>
            <label
              htmlFor="activityTimeoutSeconds"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Activity Timeout (seconds)
            </label>
            <input
              type="number"
              id="activityTimeoutSeconds"
              value={activityTimeoutSeconds}
              onChange={(e) => setActivityTimeoutSeconds(e.target.value)}
              min="60"
              placeholder={String(DEFAULT_LOOP_CONFIG.activityTimeoutSeconds)}
              className="mt-1 block w-32 rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:border-gray-600 dark:bg-neutral-700 dark:text-gray-100 dark:focus:ring-gray-600"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Time without AI activity before treating as error and retrying. Minimum: 60 seconds. (default: {DEFAULT_LOOP_CONFIG.activityTimeoutSeconds})
            </p>
          </div>

          {/* Clear planning folder */}
          <div>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={clearPlanningFolder}
                onChange={(e) => setClearPlanningFolder(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-gray-700 focus:ring-gray-500 dark:border-gray-600 dark:bg-neutral-700 dark:text-gray-300"
              />
              <div className="flex-1">
                <span className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Clear ./.planning folder
                </span>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Delete existing plan and status files before starting
                </p>
              </div>
            </label>
          </div>
        </div>
      )}

      {/* Actions - only render inline if renderActions prop is not provided */}
      {!renderActions && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
          <div className="flex flex-wrap items-center gap-2">{leadingActions}</div>
          
          {/* Right side - Cancel, Save as Draft, and Create/Start buttons */}
          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 sm:ml-auto">
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            {!isChatMode && (!isEditing || isEditingDraft) && (
              <Button
                type="button"
                variant="secondary"
                onClick={(e) => handleSubmit(e, true)}
                disabled={isSubmitting || !canSaveDraft}
                loading={isSubmitting}
              >
                {isEditingDraft ? "Update Draft" : "Save as Draft"}
              </Button>
            )}
            <Button type="submit" loading={isSubmitting} disabled={isSubmitting || !canSubmit}>
              {isChatMode
                ? "Start Chat"
                : isEditing
                  ? (planMode ? "Start Plan" : "Start Loop")
                  : (planMode ? "Create Plan" : "Create Loop")
              }
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

export default CreateLoopForm;

function TitleSparkIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
      />
    </svg>
  );
}
