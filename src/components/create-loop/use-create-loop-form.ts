/**
 * useCreateLoopForm — state management hook for CreateLoopForm.
 *
 * Encapsulates all useState, useEffect, useCallback, useRef, and submission
 * logic so that the form component can stay as a thin renderer.
 */

import { useState, useEffect, useRef, useCallback, type FormEvent } from "react";
import type { CreateLoopRequest, CreateChatRequest } from "../../types";
import { DEFAULT_LOOP_CONFIG } from "../../types/loop";
import { makeModelKey, parseModelKey, isModelEnabled, modelVariantExists } from "../ModelSelector";
import { createLogger } from "../../lib/logger";
import { useToast } from "../../hooks";
import { generateLoopTitleApi } from "../../hooks/loopActions";
import type { CreateLoopFormProps, CreateLoopFormSubmitRequest } from "./types";

const log = createLogger("CreateLoopForm");

export interface UseCreateLoopFormReturn {
  // Refs
  formRef: React.RefObject<HTMLFormElement | null>;
  nameRef: React.MutableRefObject<string>;
  promptRef: React.MutableRefObject<string>;

  // Derived flags
  isEditing: boolean;
  isChatMode: boolean;
  isSubmitting: boolean;
  canSubmit: boolean;
  canSaveDraft: boolean;
  canGenerateTitle: boolean;

  // Workspace
  selectedWorkspaceId: string | undefined;
  selectedWorkspaceDirectory: string;
  handleWorkspaceSelect: (workspaceId: string | null, workspaceDirectory: string) => void;

  // Fields
  name: string;
  setName: (v: string) => void;
  prompt: string;
  setPrompt: (v: string) => void;
  selectedModel: string;
  setSelectedModel: (v: string) => void;
  selectedBranch: string;
  setSelectedBranch: (v: string) => void;
  setUserChangedBranch: (v: boolean) => void;
  selectedTemplate: string;
  setSelectedTemplate: (v: string) => void;
  planMode: boolean;
  setPlanMode: (v: boolean) => void;
  planModeAutoReply: boolean;
  setPlanModeAutoReply: (v: boolean) => void;
  useWorktree: boolean;
  setUseWorktree: (v: boolean) => void;
  clearPlanningFolder: boolean;
  setClearPlanningFolder: (v: boolean) => void;
  showAdvanced: boolean;
  setShowAdvanced: (v: boolean) => void;
  maxIterations: string;
  setMaxIterations: (v: string) => void;
  maxConsecutiveErrors: string;
  setMaxConsecutiveErrors: (v: string) => void;
  activityTimeoutSeconds: string;
  setActivityTimeoutSeconds: (v: string) => void;
  generatingTitle: boolean;

  // Handlers
  handleSubmit: (e: FormEvent, asDraft?: boolean) => Promise<void>;
  handleGenerateTitle: () => Promise<void>;
  handleExternalCancel: () => void;
  handleExternalSubmit: () => void;
  handleExternalSaveAsDraft: () => void;
}

export function useCreateLoopForm({
  onSubmit,
  onCancel,
  closeOnSuccess = true,
  loading = false,
  models = [],
  lastModel,
  onWorkspaceChange,
  currentBranch = "",
  defaultBranch = "",
  editLoopId = null,
  initialLoopData = null,
  isEditingDraft = false,
  renderActions,
  mode = "loop",
}: Pick<
  CreateLoopFormProps,
  | "onSubmit"
  | "onCancel"
  | "closeOnSuccess"
  | "loading"
  | "models"
  | "lastModel"
  | "onWorkspaceChange"
  | "currentBranch"
  | "defaultBranch"
  | "editLoopId"
  | "initialLoopData"
  | "isEditingDraft"
  | "renderActions"
  | "mode"
>): UseCreateLoopFormReturn {
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
  const [maxIterations, setMaxIterations] = useState<string>(
    initialLoopData?.maxIterations?.toString() ?? ""
  );
  const [maxConsecutiveErrors, setMaxConsecutiveErrors] = useState<string>(
    initialLoopData?.maxConsecutiveErrors?.toString() ?? "10"
  );
  const [activityTimeoutSeconds, setActivityTimeoutSeconds] = useState<string>(
    initialLoopData?.activityTimeoutSeconds?.toString() ??
      String(DEFAULT_LOOP_CONFIG.activityTimeoutSeconds)
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [selectedBranch, setSelectedBranch] = useState<string>(
    initialLoopData?.baseBranch ?? ""
  );
  // Track whether user has manually changed the branch selection
  const [userChangedBranch, setUserChangedBranch] = useState(!!initialLoopData?.baseBranch);
  const [useWorktree, setUseWorktree] = useState(
    initialLoopData?.useWorktree ?? DEFAULT_LOOP_CONFIG.useWorktree
  );
  const [clearPlanningFolder, setClearPlanningFolder] = useState(
    initialLoopData?.clearPlanningFolder ?? false
  );
  const [planMode, setPlanMode] = useState(initialLoopData?.planMode ?? true);
  const [planModeAutoReply, setPlanModeAutoReply] = useState(
    initialLoopData?.planModeAutoReply ?? DEFAULT_LOOP_CONFIG.planModeAutoReply
  );
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [generatingTitle, setGeneratingTitle] = useState(false);

  // Sync prompt state when initialLoopData changes (safety measure for component reuse)
  useEffect(() => {
    const newPrompt = initialLoopData?.prompt ?? "";
    log.debug("Syncing prompt from initialLoopData", {
      promptLength: newPrompt.length,
      promptPreview: newPrompt.slice(0, 50),
      hasInitialLoopData: !!initialLoopData,
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
    log.debug("useEffect 1 - branch reset", { defaultBranch, userChangedBranch, isEditing });
    if (defaultBranch && !userChangedBranch && !isEditing) {
      log.debug("Setting selected branch to:", defaultBranch);
      setSelectedBranch(defaultBranch);
    }
  }, [defaultBranch, userChangedBranch, isEditing]);

  // Set initial model when lastModel, models, or initialLoopData change
  useEffect(() => {
    log.debug("useEffect 2 - model selection", {
      selectedModel,
      lastModel,
      modelsCount: models.length,
      initialLoopDataModel: initialLoopData?.model,
    });
    if (selectedModel) return; // Don't override if user already selected

    if (initialLoopData?.model && models.length > 0) {
      const variant = initialLoopData.model.variant ?? "";
      if (
        modelVariantExists(
          models,
          initialLoopData.model.providerID,
          initialLoopData.model.modelID,
          variant
        )
      ) {
        const modelKey = makeModelKey(
          initialLoopData.model.providerID,
          initialLoopData.model.modelID,
          variant
        );
        log.debug("Setting model from initialLoopData:", modelKey);
        setSelectedModel(modelKey);
        return;
      }
    }

    if (lastModel && models.length > 0) {
      const variant = lastModel.variant ?? "";
      if (modelVariantExists(models, lastModel.providerID, lastModel.modelID, variant)) {
        const modelKey = makeModelKey(lastModel.providerID, lastModel.modelID, variant);
        log.debug("Setting model from lastModel:", modelKey);
        setSelectedModel(modelKey);
        return;
      }
    }

    // Default to first connected model (with first variant or empty variant)
    const firstConnected = models.find((m) => m.connected);
    if (firstConnected) {
      const variant =
        firstConnected.variants && firstConnected.variants.length > 0
          ? firstConnected.variants[0]
          : "";
      const modelKey = makeModelKey(firstConnected.providerID, firstConnected.modelID, variant);
      log.debug("Setting model to first connected:", modelKey);
      setSelectedModel(modelKey);
    }
  }, [lastModel, models, selectedModel, initialLoopData]);

  // Notify parent when workspace changes
  useEffect(() => {
    log.debug("useEffect 3 - workspace change", {
      selectedWorkspaceId,
      selectedWorkspaceDirectory,
      isInitialMount: isInitialMount.current,
      hasOnWorkspaceChange: !!onWorkspaceChange,
    });
    if (isInitialMount.current) {
      isInitialMount.current = false;
      if (initialLoopData?.workspaceId && initialLoopData?.directory && onWorkspaceChange) {
        log.debug(
          "Initial call to onWorkspaceChange:",
          initialLoopData.workspaceId,
          initialLoopData.directory
        );
        onWorkspaceChange(initialLoopData.workspaceId, initialLoopData.directory);
      }
      return;
    }

    if (!onWorkspaceChange) return;

    log.debug("Calling onWorkspaceChange:", selectedWorkspaceId, selectedWorkspaceDirectory);
    onWorkspaceChange(selectedWorkspaceId ?? null, selectedWorkspaceDirectory);
    // Note: onWorkspaceChange is intentionally NOT in deps array to prevent infinite loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedWorkspaceId,
    selectedWorkspaceDirectory,
    initialLoopData?.workspaceId,
    initialLoopData?.directory,
  ]);

  // Reset branch selection flag when workspace changes
  useEffect(() => {
    log.debug("useEffect 4 - reset userChangedBranch", {
      isEditing,
      isInitialMount: isInitialMount.current,
      selectedWorkspaceId,
    });
    if (!isEditing && !isInitialMount.current) {
      log.debug("Resetting userChangedBranch to false");
      setUserChangedBranch(false);
    }
  }, [selectedWorkspaceId, isEditing]);

  const handleSubmit = useCallback(
    async (e: FormEvent, asDraft = false) => {
      e.preventDefault();

      const currentName = nameRef.current;
      const currentPrompt = promptRef.current;

      log.debug("handleSubmit - Form state", {
        asDraft,
        promptLength: currentPrompt.length,
        promptPreview: currentPrompt.slice(0, 50),
        selectedWorkspaceId,
      });

      if (!selectedWorkspaceId) return;
      if (!currentPrompt.trim()) return;
      if (!isChatMode && !currentName.trim()) return;
      if (!selectedModel || !selectedModelEnabled) return;

      setSubmitting(true);

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
        log.error("Failed to create loop:", error);
      } finally {
        setSubmitting(false);
      }
      // Note: onSubmit and onCancel intentionally NOT in deps (parent callbacks)
      // Note: prompt/name read from refs to avoid stale closures
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [
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
    ]
  );

  const isSubmitting = loading || submitting;

  // Form ref for programmatic submission
  const formRef = useRef<HTMLFormElement>(null);
  const cancelActionRef = useRef(onCancel);
  const submitActionRef = useRef<() => void>(() => {});
  const saveAsDraftActionRef = useRef<() => void>(() => {});

  const canSaveDraft =
    !isChatMode && !!selectedWorkspaceId && !!prompt.trim() && !!name.trim();
  const canSubmit =
    !!selectedWorkspaceId &&
    !!prompt.trim() &&
    (isChatMode || !!name.trim()) &&
    selectedModelEnabled;
  const canGenerateTitle =
    !isChatMode && !!selectedWorkspaceId && !!prompt.trim() && !isSubmitting && !generatingTitle;

  const handleSubmitClick = useCallback(() => {
    if (formRef.current) {
      formRef.current.requestSubmit();
    }
  }, []);

  const handleSaveAsDraftClick = useCallback(() => {
    if (formRef.current && canSaveDraft) {
      const syntheticEvent = { preventDefault: () => {} } as FormEvent;
      void handleSubmit(syntheticEvent, true);
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
    log.debug("useEffect 5 - renderActions deps changed:", {
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
        isEditingDraft: isEditingDraft ?? false,
        planMode,
        onCancel: handleExternalCancel,
        onSubmit: handleExternalSubmit,
        onSaveAsDraft: handleExternalSaveAsDraft,
      });
    }
    // Note: renderActions intentionally NOT in deps — notify only on action state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSubmitting, canSubmit, canSaveDraft, isEditing, isEditingDraft, planMode]);

  function handleWorkspaceSelect(workspaceId: string | null, workspaceDirectory: string) {
    setSelectedWorkspaceId(workspaceId || undefined);
    setSelectedWorkspaceDirectory(workspaceDirectory);
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

  return {
    formRef,
    nameRef,
    promptRef,
    isEditing,
    isChatMode,
    isSubmitting,
    canSubmit,
    canSaveDraft,
    canGenerateTitle,
    selectedWorkspaceId,
    selectedWorkspaceDirectory,
    handleWorkspaceSelect,
    name,
    setName,
    prompt,
    setPrompt,
    selectedModel,
    setSelectedModel,
    selectedBranch,
    setSelectedBranch,
    setUserChangedBranch,
    selectedTemplate,
    setSelectedTemplate,
    planMode,
    setPlanMode,
    planModeAutoReply,
    setPlanModeAutoReply,
    useWorktree,
    setUseWorktree,
    clearPlanningFolder,
    setClearPlanningFolder,
    showAdvanced,
    setShowAdvanced,
    maxIterations,
    setMaxIterations,
    maxConsecutiveErrors,
    setMaxConsecutiveErrors,
    activityTimeoutSeconds,
    setActivityTimeoutSeconds,
    generatingTitle,
    handleSubmit,
    handleGenerateTitle,
    handleExternalCancel,
    handleExternalSubmit,
    handleExternalSaveAsDraft,
  };
}
