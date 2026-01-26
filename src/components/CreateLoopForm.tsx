/**
 * CreateLoopForm component for creating new Ralph Loops.
 */

import { useState, useEffect, type FormEvent } from "react";
import type { CreateLoopRequest, ModelInfo } from "../types";
import { Button } from "./common";

/**
 * Branch information for the branch selector.
 */
export interface BranchInfo {
  /** Branch name */
  name: string;
  /** Whether this is the current branch */
  current: boolean;
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
  /** Last used model */
  lastModel?: { providerID: string; modelID: string } | null;
  /** Callback when directory changes (to reload models and branches) */
  onDirectoryChange?: (directory: string) => void;
  /** Warning about .planning directory */
  planningWarning?: string | null;
  /** Available branches for the directory */
  branches?: BranchInfo[];
  /** Whether branches are loading */
  branchesLoading?: boolean;
  /** Current branch name */
  currentBranch?: string;
  /** Initial directory to pre-fill (last used) */
  initialDirectory?: string;
  /** Loop ID if editing an existing draft */
  editLoopId?: string | null;
  /** Initial loop data for editing */
  initialLoopData?: {
    name: string;
    directory: string;
    prompt: string;
    model?: { providerID: string; modelID: string };
    maxIterations?: number;
    maxConsecutiveErrors?: number;
    activityTimeoutSeconds?: number;
    baseBranch?: string;
    clearPlanningFolder?: boolean;
    planMode?: boolean;
  } | null;
  /** Whether editing a draft loop (to show Update Draft button) */
  isEditingDraft?: boolean;
}

export function CreateLoopForm({
  onSubmit,
  onCancel,
  loading = false,
  models = [],
  modelsLoading = false,
  lastModel,
  onDirectoryChange,
  planningWarning,
  branches = [],
  branchesLoading = false,
  currentBranch = "",
  initialDirectory = "",
  editLoopId = null,
  initialLoopData = null,
  isEditingDraft = false,
}: CreateLoopFormProps) {
  const isEditing = !!editLoopId;
  
  const [name, setName] = useState(initialLoopData?.name ?? "Continue working on the plan");
  const [directory, setDirectory] = useState(initialLoopData?.directory ?? initialDirectory);
  const [prompt, setPrompt] = useState(initialLoopData?.prompt ?? "Do everything that's pending in the plan");
  const [maxIterations, setMaxIterations] = useState<string>(initialLoopData?.maxIterations?.toString() ?? "");
  const [maxConsecutiveErrors, setMaxConsecutiveErrors] = useState<string>(initialLoopData?.maxConsecutiveErrors?.toString() ?? "10");
  const [activityTimeoutSeconds, setActivityTimeoutSeconds] = useState<string>(initialLoopData?.activityTimeoutSeconds?.toString() ?? "180");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [selectedBranch, setSelectedBranch] = useState<string>(initialLoopData?.baseBranch ?? "");
  const [clearPlanningFolder, setClearPlanningFolder] = useState(initialLoopData?.clearPlanningFolder ?? false);
  const [planMode, setPlanMode] = useState(initialLoopData?.planMode ?? false);

  // Update directory when initialDirectory prop changes (e.g., after async fetch)
  useEffect(() => {
    if (initialDirectory && !directory) {
      setDirectory(initialDirectory);
    }
  }, [initialDirectory, directory]);

  // Reset selected branch when current branch changes (directory changed)
  useEffect(() => {
    // Default to current branch when it changes
    if (currentBranch) {
      setSelectedBranch(currentBranch);
    }
  }, [currentBranch]);

  // Set initial model when lastModel, models, or initialLoopData change
  useEffect(() => {
    if (selectedModel) return; // Don't override if user already selected

    // If editing and initial loop data has a model, use that
    if (initialLoopData?.model && models.length > 0) {
      const modelKey = `${initialLoopData.model.providerID}:${initialLoopData.model.modelID}`;
      const exists = models.some(
        (m) => `${m.providerID}:${m.modelID}` === modelKey
      );
      if (exists) {
        setSelectedModel(modelKey);
        return;
      }
    }

    // Otherwise, try lastModel
    if (lastModel && models.length > 0) {
      const modelKey = `${lastModel.providerID}:${lastModel.modelID}`;
      const exists = models.some(
        (m) => `${m.providerID}:${m.modelID}` === modelKey
      );
      if (exists) {
        setSelectedModel(modelKey);
        return;
      }
    }

    // Default to first connected model
    const firstConnected = models.find((m) => m.connected);
    if (firstConnected) {
      setSelectedModel(`${firstConnected.providerID}:${firstConnected.modelID}`);
    }
  }, [lastModel, models, selectedModel, initialLoopData]);

  // Notify parent when directory changes (debounced)
  useEffect(() => {
    if (!directory.trim() || !onDirectoryChange) return;

    const timer = setTimeout(() => {
      onDirectoryChange(directory.trim());
    }, 500);

    return () => clearTimeout(timer);
  }, [directory, onDirectoryChange]);

  async function handleSubmit(e: FormEvent, asDraft = false) {
    e.preventDefault();

    if (!name.trim() || !directory.trim() || !prompt.trim()) {
      return;
    }

    setSubmitting(true);

    const request: CreateLoopRequest = {
      name: name.trim(),
      directory: directory.trim(),
      prompt: prompt.trim(),
      // Backend settings are now global (not per-loop)
      // Git is always enabled - no toggle exposed to users
    };

    // Add model if selected
    if (selectedModel) {
      const [providerID, modelID] = selectedModel.split(":");
      if (providerID && modelID) {
        request.model = { providerID, modelID };
      }
    }

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

    // Add clearPlanningFolder if enabled
    if (clearPlanningFolder) {
      request.clearPlanningFolder = true;
    }

    // Add planMode if enabled (unless saving as draft)
    if (planMode && !asDraft) {
      request.planMode = true;
    }

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
      console.error("Failed to create loop:", error);
    } finally {
      setSubmitting(false);
    }
  }

  const isSubmitting = loading || submitting;

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
  const connectedProviders = Object.keys(modelsByProvider)
    .filter((provider) => {
      const providerModels = modelsByProvider[provider];
      return providerModels && providerModels.some((m) => m.connected);
    })
    .sort((a, b) => a.localeCompare(b));
  const disconnectedProviders = Object.keys(modelsByProvider)
    .filter((provider) => {
      const providerModels = modelsByProvider[provider];
      return providerModels && !providerModels.some((m) => m.connected);
    })
    .sort((a, b) => a.localeCompare(b));

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Name */}
      <div>
        <label
          htmlFor="name"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Continue working on the plan"
          required
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
        />
      </div>

      {/* Directory */}
      <div>
        <label
          htmlFor="directory"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Working Directory <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          id="directory"
          value={directory}
          onChange={(e) => setDirectory(e.target.value)}
          placeholder="/path/to/project"
          required
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 font-mono text-sm placeholder:text-gray-400 dark:placeholder:text-gray-500"
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Absolute path to the project directory
        </p>
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
          onChange={(e) => setSelectedBranch(e.target.value)}
          disabled={branchesLoading || branches.length === 0}
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 disabled:opacity-50 font-mono text-sm"
        >
          {branchesLoading && (
            <option value="">Loading branches...</option>
          )}
          {!branchesLoading && branches.length === 0 && (
            <option value="">Enter directory to load branches</option>
          )}
          {!branchesLoading && branches.length > 0 && (
            <>
              {/* Current branch first */}
              {currentBranch && (
                <option value={currentBranch}>
                  {currentBranch} (current)
                </option>
              )}
              {/* Main branch if not current */}
              {branches.some((b) => b.name === "main" && !b.current) && (
                <option value="main">main</option>
              )}
              {/* Separator if we have special branches */}
              {(currentBranch || branches.some((b) => b.name === "main")) && branches.length > 1 && (
                <option disabled>──────────</option>
              )}
              {/* Other branches sorted by name */}
              {branches
                .filter((b) => !b.current && b.name !== "main")
                .map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                  </option>
                ))}
            </>
          )}
        </select>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Branch to base the loop on (default: current branch)
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
            <option value="">Enter directory to load models</option>
          )}
          {!modelsLoading && models.length > 0 && (
            <>
              <option value="">Select a model...</option>
              {/* Connected providers first */}
              {connectedProviders.map((provider) => {
                const providerModels = modelsByProvider[provider] ?? [];
                return (
                  <optgroup key={provider} label={`${provider} (connected)`}>
                    {providerModels.map((model) => (
                      <option
                        key={`${model.providerID}:${model.modelID}`}
                        value={`${model.providerID}:${model.modelID}`}
                      >
                        {model.modelName}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
              {/* Disconnected providers */}
              {disconnectedProviders.map((provider) => {
                const providerModels = modelsByProvider[provider] ?? [];
                return (
                  <optgroup key={provider} label={`${provider} (not connected)`}>
                    {providerModels.map((model) => (
                      <option
                        key={`${model.providerID}:${model.modelID}`}
                        value={`${model.providerID}:${model.modelID}`}
                        disabled
                      >
                        {model.modelName}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </>
          )}
        </select>
        {!modelsLoading && models.length > 0 && !selectedModel && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            No model selected - will use default from opencode config
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
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={planMode ? "Describe what you want to achieve. The AI will create a detailed plan based on this." : "Do everything that's pending in the plan"}
          required
          rows={5}
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
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
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
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

      {/* Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
        {/* Left side - Save as Draft / Update Draft button */}
        {(!isEditing || isEditingDraft) && (
          <Button
            type="button"
            variant="secondary"
            onClick={(e) => handleSubmit(e, true)}
            disabled={isSubmitting || !name.trim() || !directory.trim() || !prompt.trim()}
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
          <Button type="submit" loading={isSubmitting}>
            {isEditing 
              ? (planMode ? "Start Plan" : "Start Loop")
              : (planMode ? "Create Plan" : "Create Loop")
            }
          </Button>
        </div>
      </div>
    </form>
  );
}

export default CreateLoopForm;
