/**
 * CreateLoopForm component for creating new Ralph Loops.
 */

import { useState, useEffect, useRef, useCallback, type FormEvent } from "react";
import type { CreateLoopRequest, ModelInfo, BranchInfo } from "../types";
import type { WorkspaceWithLoopCount } from "../types/workspace";
import { Button } from "./common";
import { WorkspaceSelector } from "./WorkspaceSelector";
import { createLogger } from "../lib/logger";

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
  onSubmit: (request: CreateLoopRequest) => Promise<boolean>;
  /** Callback when form is cancelled */
  onCancel: () => void;
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
    directory: string;
    prompt: string;
    model?: { providerID: string; modelID: string; variant?: string };
    maxIterations?: number;
    maxConsecutiveErrors?: number;
    activityTimeoutSeconds?: number;
    baseBranch?: string;
    clearPlanningFolder?: boolean;
    planMode?: boolean;
    workspaceId?: string;
  } | null;
  /** Whether editing a draft loop (to show Update Draft button) */
  isEditingDraft?: boolean;
  /** Available workspaces */
  workspaces?: WorkspaceWithLoopCount[];
  /** Whether workspaces are loading */
  workspacesLoading?: boolean;
  /** Workspace-related error */
  workspaceError?: string | null;
  /** 
   * Optional render prop for action buttons. When provided, action buttons 
   * are NOT rendered inside the form - caller is responsible for rendering them.
   * This is useful for rendering actions in a Modal footer (sticky position).
   */
  renderActions?: (state: CreateLoopFormActionState) => void;
}

export function CreateLoopForm({
  onSubmit,
  onCancel,
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
  renderActions,
}: CreateLoopFormProps) {
  const isEditing = !!editLoopId;
  
  // Track if this is the first render to prevent infinite loops
  const isInitialMount = useRef(true);
  
  // Ref to track current prompt value - used to avoid stale closures in callbacks
  // passed to parent via renderActions. The ref is always up-to-date even when
  // the callbacks aren't recreated (to avoid re-renders in parent).
  const promptRef = useRef(initialLoopData?.prompt ?? "");
  
  // Workspace state - the only source of truth for directory
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | undefined>(
    initialLoopData?.workspaceId
  );
  const [selectedWorkspaceDirectory, setSelectedWorkspaceDirectory] = useState<string>(
    initialLoopData?.directory ?? ""
  );
  
  const [prompt, setPrompt] = useState(initialLoopData?.prompt ?? "");
  const [maxIterations, setMaxIterations] = useState<string>(initialLoopData?.maxIterations?.toString() ?? "");
  const [maxConsecutiveErrors, setMaxConsecutiveErrors] = useState<string>(initialLoopData?.maxConsecutiveErrors?.toString() ?? "10");
  const [activityTimeoutSeconds, setActivityTimeoutSeconds] = useState<string>(initialLoopData?.activityTimeoutSeconds?.toString() ?? "180");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [selectedBranch, setSelectedBranch] = useState<string>(initialLoopData?.baseBranch ?? "");
  // Track whether user has manually changed the branch selection
  const [userChangedBranch, setUserChangedBranch] = useState(!!initialLoopData?.baseBranch);
  const [clearPlanningFolder, setClearPlanningFolder] = useState(initialLoopData?.clearPlanningFolder ?? false);
  const [planMode, setPlanMode] = useState(initialLoopData?.planMode ?? true);

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

  // Check if the selected model is enabled (connected)
  // Format: providerID:modelID:variant (variant can be empty string)
  const isSelectedModelEnabled = (): boolean => {
    if (!selectedModel) return false; // No model selected = not valid (model is required)
    const parts = selectedModel.split(":");
    // Format is providerID:modelID:variant (variant may be empty)
    if (parts.length < 2) return false;
    const providerID = parts[0];
    const modelID = parts[1];
    if (!providerID || !modelID) return false;
    const model = models.find((m) => m.providerID === providerID && m.modelID === modelID);
    return model?.connected ?? false;
  };
  
  const selectedModelEnabled = isSelectedModelEnabled();

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

    // Helper to create model key with variant
    // Format: providerID:modelID:variant (variant can be empty string)
    const makeModelKey = (m: { providerID: string; modelID: string; variant?: string }) => {
      const variant = m.variant ?? "";
      return `${m.providerID}:${m.modelID}:${variant}`;
    };

    // Helper to check if a model+variant combination exists in the models list
    const modelVariantExists = (providerID: string, modelID: string, variant: string): boolean => {
      const model = models.find((m) => m.providerID === providerID && m.modelID === modelID);
      if (!model) return false;
      // If model has no variants, only empty string variant is valid
      if (!model.variants || model.variants.length === 0) {
        return variant === "";
      }
      // Check if variant exists in model's variants
      return model.variants.includes(variant);
    };

    // If editing and initial loop data has a model, use that
    if (initialLoopData?.model && models.length > 0) {
      const variant = initialLoopData.model.variant ?? "";
      if (modelVariantExists(initialLoopData.model.providerID, initialLoopData.model.modelID, variant)) {
        const modelKey = makeModelKey(initialLoopData.model);
        log.debug('Setting model from initialLoopData:', modelKey);
        setSelectedModel(modelKey);
        return;
      }
    }

    // Otherwise, try lastModel
    if (lastModel && models.length > 0) {
      const variant = lastModel.variant ?? "";
      if (modelVariantExists(lastModel.providerID, lastModel.modelID, variant)) {
        const modelKey = makeModelKey(lastModel);
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
      const modelKey = `${firstConnected.providerID}:${firstConnected.modelID}:${variant}`;
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
    
    // Validate model is enabled if selected (required for all submissions including drafts)
    if (!selectedModel || !selectedModelEnabled) {
      return;
    }

    setSubmitting(true);

    // Parse model from selectedModel string
    // Format: providerID:modelID:variant (variant can be empty string)
    const parts = selectedModel.split(":");
    const providerID = parts[0];
    const modelID = parts[1];
    // Variant is everything after the second colon (may be empty string)
    const variant = parts.length >= 3 ? parts.slice(2).join(":") : "";
    
    if (!providerID || !modelID) {
      setSubmitting(false);
      return;
    }

    const request: CreateLoopRequest = {
      workspaceId: selectedWorkspaceId,
      prompt: currentPrompt.trim(),
      planMode: planMode, // planMode is required
      model: { providerID, modelID, variant },
      // Backend settings are now global (not per-loop)
      // Git is always enabled - no toggle exposed to users
    };

    if (maxIterations.trim()) {
      const num = parseInt(maxIterations, 10);
      if (!isNaN(num) && num > 0) {
        request.maxIterations = num;
      }
    }

    if (maxConsecutiveErrors.trim()) {
      const num = parseInt(maxConsecutiveErrors, 10);
      if (!isNaN(num) && num >= 0) {
        // 0 means unlimited, positive number is the limit
        request.maxConsecutiveErrors = num === 0 ? 0 : num;
      }
    }

    if (activityTimeoutSeconds.trim()) {
      const num = parseInt(activityTimeoutSeconds, 10);
      if (!isNaN(num) && num >= 60) {
        request.activityTimeoutSeconds = num;
      }
    }

    // Add base branch if different from current
    if (selectedBranch && selectedBranch !== currentBranch) {
      request.baseBranch = selectedBranch;
    }

    // Always include clearPlanningFolder (persist in draft to remember user's choice)
    request.clearPlanningFolder = clearPlanningFolder;

    // Always include planMode (persist in draft to remember user's choice)
    request.planMode = planMode;

    // Add draft flag if saving as draft
    if (asDraft) {
      request.draft = true;
    }

    try {
      const success = await onSubmit(request);
      if (success) {
        // Close the modal on successful submission
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
    // Note: prompt is NOT in deps because we read from promptRef.current
    // This avoids stale closures when callbacks are passed to parent via renderActions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedWorkspaceId,
    selectedModel,
    selectedModelEnabled,
    planMode,
    maxIterations,
    maxConsecutiveErrors,
    activityTimeoutSeconds,
    selectedBranch,
    currentBranch,
    clearPlanningFolder,
  ]);

  const isSubmitting = loading || submitting;

  // Form ref for programmatic submission
  const formRef = useRef<HTMLFormElement>(null);
  
  // Check if form can be saved as a draft (basic fields only, model connectivity not required)
  const canSaveDraft = !!selectedWorkspaceId && !!prompt.trim();
  
  // Check if form can be submitted to start a loop (also needs model to be enabled)
  const canSubmit = canSaveDraft && selectedModelEnabled;
  
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
        onCancel,
        onSubmit: handleSubmitClick,
        onSaveAsDraft: handleSaveAsDraftClick,
      });
    }
    // Note: renderActions, onCancel, handleSubmitClick, handleSaveAsDraftClick are intentionally NOT in deps
    // They are callbacks that change frequently but don't need to retrigger this effect
    // We only want to notify parent when the actual state values change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSubmitting, canSubmit, canSaveDraft, isEditing, isEditingDraft, planMode]);

  // Group models by provider and sort by name
  const modelsByProvider = models.reduce<Record<string, ModelInfo[]>>(
    (acc, model) => {
      const key = model.providerName;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(model);
      return acc;
    },
    {}
  );

  // Sort models within each provider by name
  for (const provider of Object.keys(modelsByProvider)) {
    const providerModels = modelsByProvider[provider];
    if (providerModels) {
      providerModels.sort((a, b) => a.modelName.localeCompare(b.modelName));
    }
  }

  // Get connected providers (for display order), sorted by name
  // Only connected providers are shown - disconnected models are not displayed
  const connectedProviders = Object.keys(modelsByProvider)
    .filter((provider) => {
      const providerModels = modelsByProvider[provider];
      return providerModels && providerModels.some((m) => m.connected);
    })
    .sort((a, b) => a.localeCompare(b));

  /**
   * Generate options for a model, expanding variants into separate options.
   * For models without variants, renders a single option.
   * For models with variants, renders one option per variant.
   */
  function renderModelOptions(model: ModelInfo, disabled: boolean = false) {
    const variants = model.variants && model.variants.length > 0 
      ? model.variants 
      : [""]; // No variants = single option with empty variant
    
    // Sort variants: empty string first, then alphabetically
    const sortedVariants = [...variants].sort((a, b) => {
      if (a === "") return -1;
      if (b === "") return 1;
      return a.localeCompare(b);
    });

    return sortedVariants.map((variant) => {
      // Format: providerID:modelID:variant
      const optionValue = `${model.providerID}:${model.modelID}:${variant}`;
      // Display: "Model Name (variant)" or just "Model Name" for empty variant
      const displayName = variant ? `${model.modelName} (${variant})` : model.modelName;
      
      return (
        <option
          key={optionValue}
          value={optionValue}
          disabled={disabled}
        >
          {displayName}
        </option>
      );
    });
  }

  // Handle workspace selection - stores both workspaceId and directory
  function handleWorkspaceSelect(workspaceId: string | null, workspaceDirectory: string) {
    setSelectedWorkspaceId(workspaceId || undefined);
    setSelectedWorkspaceDirectory(workspaceDirectory);
    // The useEffect watching selectedWorkspaceId will notify parent
  }

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
        />
        {planningWarning && (
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
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 disabled:opacity-50 font-mono text-sm"
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
        <select
          id="model"
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          disabled={modelsLoading || models.length === 0}
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 disabled:opacity-50"
        >
          {modelsLoading && (
            <option value="">Loading models...</option>
          )}
          {!modelsLoading && models.length === 0 && (
            <option value="">Select a workspace to load models</option>
          )}
          {!modelsLoading && models.length > 0 && (
            <>
              <option value="">Select a model...</option>
              {/* Only show connected providers */}
              {connectedProviders.map((provider) => {
                const providerModels = modelsByProvider[provider] ?? [];
                return (
                  <optgroup key={provider} label={provider}>
                    {providerModels.map((model) => renderModelOptions(model, false))}
                  </optgroup>
                );
              })}
              {/* Show message if no providers are connected */}
              {connectedProviders.length === 0 && (
                <option value="" disabled>No connected providers available</option>
              )}
            </>
          )}
        </select>
        {!modelsLoading && models.length > 0 && connectedProviders.length === 0 && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            No providers are connected. Please configure API credentials in the opencode server.
          </p>
        )}
        {!modelsLoading && models.length > 0 && connectedProviders.length > 0 && !selectedModel && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            Model is required. Please select a model.
          </p>
        )}
      </div>

      {/* Prompt */}
      <div>
        <label
          htmlFor="prompt"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Prompt <span className="text-red-500">*</span>
        </label>
        <textarea
          id="prompt"
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            promptRef.current = e.target.value;
          }}
          placeholder={planMode ? "Describe what you want to achieve. The AI will create a detailed plan based on this." : "Do everything that's pending in the plan"}
          required
          rows={3}
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 min-h-[76px] sm:min-h-[120px] resize-y"
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          The prompt sent to the AI agent at the start of each iteration
        </p>
      </div>

      {/* Plan Mode Toggle */}
      <div>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={planMode}
            onChange={(e) => setPlanMode(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
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

      {/* Advanced options toggle */}
      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
      >
        {showAdvanced ? "Hide" : "Show"} advanced options
      </button>

      {/* Advanced options */}
      {showAdvanced && (
        <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-md">
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
              className="mt-1 block w-32 rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
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
              className="mt-1 block w-32 rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
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
              placeholder="180"
              className="mt-1 block w-32 rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Time without AI activity before treating as error and retrying. Minimum: 60 seconds. (default: 180)
            </p>
          </div>

          {/* Clear planning folder */}
          <div>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={clearPlanningFolder}
                onChange={(e) => setClearPlanningFolder(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
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
          {/* Left side - Save as Draft / Update Draft button */}
          {(!isEditing || isEditingDraft) && (
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
          
          {/* Right side - Cancel and Create/Start buttons */}
          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 sm:ml-auto">
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting} disabled={isSubmitting || !canSubmit}>
              {isEditing 
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
