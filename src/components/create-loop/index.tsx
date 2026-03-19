/**
 * CreateLoopForm component for creating new Ralph Loops.
 */

import { useState, useEffect, useRef, useCallback, type FormEvent } from "react";
import type { CreateLoopRequest, CreateChatRequest } from "../../types";
import { DEFAULT_LOOP_CONFIG } from "../../types/loop";
import { WorkspaceSelector } from "../WorkspaceSelector";
import { makeModelKey, parseModelKey, isModelEnabled, modelVariantExists } from "../ModelSelector";
import { createLogger } from "../../lib/logger";
import { useToast } from "../../hooks";
import { generateLoopTitleApi } from "../../hooks/loopActions";
import {
  type CreateLoopFormActionState,
  type CreateLoopFormProps,
  type CreateLoopFormSubmitRequest,
  getComposeDraftActionLabel,
  getComposeSubmitActionLabel,
} from "./types";
import { BranchSelector } from "./branch-selector";
import { ModelField } from "./model-field";
import { TemplateSelector } from "./template-selector";
import { TitleField } from "./title-field";
import { PromptField } from "./prompt-field";
import { LoopSettings } from "./loop-settings";
import { AdvancedOptions } from "./advanced-options";
import { FormActions } from "./form-actions";

export type { CreateLoopFormActionState, CreateLoopFormProps, CreateLoopFormSubmitRequest };
export { getComposeDraftActionLabel, getComposeSubmitActionLabel };

// Create a named logger for this component
const log = createLogger("CreateLoopForm");

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
      <BranchSelector
        selectedBranch={selectedBranch}
        onBranchChange={(branch) => {
          setSelectedBranch(branch);
          setUserChangedBranch(true);
        }}
        branches={branches}
        branchesLoading={branchesLoading}
        defaultBranch={defaultBranch}
        currentBranch={currentBranch}
      />

      {/* Model Selection */}
      <ModelField
        selectedModel={selectedModel}
        onChange={setSelectedModel}
        models={models}
        modelsLoading={modelsLoading}
      />

      {/* Prompt Template — hidden in chat mode */}
      {!isChatMode && (
        <TemplateSelector
          selectedTemplate={selectedTemplate}
          onChange={setSelectedTemplate}
          onPromptChange={(p) => {
            setPrompt(p);
            promptRef.current = p;
          }}
          onPlanModeChange={setPlanMode}
          promptRef={promptRef}
        />
      )}

      {/* Title — hidden in chat mode */}
      {!isChatMode && (
        <TitleField
          name={name}
          onChange={(value) => {
            setName(value);
            nameRef.current = value;
          }}
          onGenerate={() => void handleGenerateTitle()}
          canGenerate={canGenerateTitle}
          generating={generatingTitle}
        />
      )}

      {/* Prompt */}
      <PromptField
        prompt={prompt}
        onChange={(value) => {
          setPrompt(value);
          promptRef.current = value;
        }}
        isChatMode={isChatMode}
        planMode={planMode}
        selectedTemplate={selectedTemplate}
        onTemplateClear={() => setSelectedTemplate("")}
      />

      {/* Plan Mode, Auto-reply, and Use Worktree toggles */}
      <LoopSettings
        isChatMode={isChatMode}
        planMode={planMode}
        onPlanModeChange={setPlanMode}
        planModeAutoReply={planModeAutoReply}
        onPlanModeAutoReplyChange={setPlanModeAutoReply}
        useWorktree={useWorktree}
        onUseWorktreeChange={setUseWorktree}
      />

      {/* Advanced options toggle + panel — hidden in chat mode */}
      <AdvancedOptions
        isChatMode={isChatMode}
        showAdvanced={showAdvanced}
        onToggle={() => setShowAdvanced(!showAdvanced)}
        maxIterations={maxIterations}
        onMaxIterationsChange={setMaxIterations}
        maxConsecutiveErrors={maxConsecutiveErrors}
        onMaxConsecutiveErrorsChange={setMaxConsecutiveErrors}
        activityTimeoutSeconds={activityTimeoutSeconds}
        onActivityTimeoutChange={setActivityTimeoutSeconds}
        clearPlanningFolder={clearPlanningFolder}
        onClearPlanningFolderChange={setClearPlanningFolder}
      />

      {/* Actions - only render inline if renderActions prop is not provided */}
      {!renderActions && (
        <FormActions
          isChatMode={isChatMode}
          isEditing={isEditing}
          isEditingDraft={isEditingDraft}
          isSubmitting={isSubmitting}
          canSubmit={canSubmit}
          canSaveDraft={canSaveDraft}
          onCancel={onCancel}
          onSaveAsDraft={(e) => handleSubmit(e, true)}
          leadingActions={leadingActions}
        />
      )}
    </form>
  );
}

export default CreateLoopForm;
