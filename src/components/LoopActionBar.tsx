/**
 * LoopActionBar component for sending messages and changing models mid-loop.
 * 
 * This component provides a mobile-responsive action bar that allows users to:
 * - Queue a message to be sent after the current iteration completes
 * - Change the model for subsequent iterations
 * 
 * The action bar is only visible when a loop is in an active state (running, waiting, planning).
 */

import { useState, useCallback, type FormEvent } from "react";
import type { ModelInfo, ModelConfig } from "../types";
import { Button } from "./common";

export interface LoopActionBarProps {
  /** Current model configuration (from loop config) */
  currentModel?: ModelConfig;
  /** Pending model that will be used for next iteration */
  pendingModel?: ModelConfig;
  /** Pending prompt that will be used for next iteration */
  pendingPrompt?: string;
  /** Available models for selection */
  models: ModelInfo[];
  /** Whether models are loading */
  modelsLoading: boolean;
  /** Callback when user queues a message and/or model change */
  onQueuePending: (options: { message?: string; model?: ModelConfig }) => Promise<boolean>;
  /** Callback when user clears pending values */
  onClearPending: () => Promise<boolean>;
  /** Whether the action bar is disabled */
  disabled?: boolean;
}

export function LoopActionBar({
  currentModel,
  pendingModel,
  pendingPrompt,
  models,
  modelsLoading,
  onQueuePending,
  onClearPending,
  disabled = false,
}: LoopActionBarProps) {
  const [message, setMessage] = useState("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Build current model key for display
  const currentModelKey = currentModel 
    ? `${currentModel.providerID}:${currentModel.modelID}` 
    : "";

  // Build pending model key for comparison
  const pendingModelKey = pendingModel
    ? `${pendingModel.providerID}:${pendingModel.modelID}`
    : "";

  // Check if we have any pending changes
  const hasPendingMessage = !!pendingPrompt;
  const hasPendingModel = !!pendingModel;
  const hasPending = hasPendingMessage || hasPendingModel;

  // Check if user has local changes (not yet submitted)
  const hasLocalChanges = message.trim().length > 0 || selectedModel !== "";

  // Group models by provider
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

  // Find model display name
  const getModelDisplayName = (modelKey: string): string => {
    if (!modelKey) return "Default";
    const model = models.find((m) => `${m.providerID}:${m.modelID}` === modelKey);
    return model?.modelName ?? modelKey.split(":")[1] ?? "Unknown";
  };

  // Handle form submission
  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    
    if (!hasLocalChanges || disabled || isSubmitting) return;

    setIsSubmitting(true);

    try {
      // Build the pending update
      const options: { message?: string; model?: ModelConfig } = {};
      
      if (message.trim()) {
        options.message = message.trim();
      }
      
      if (selectedModel) {
        const [providerID, modelID] = selectedModel.split(":");
        if (providerID && modelID) {
          options.model = { providerID, modelID };
        }
      }

      const success = await onQueuePending(options);
      if (success) {
        // Clear local state on success
        setMessage("");
        setSelectedModel("");
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [hasLocalChanges, disabled, isSubmitting, message, selectedModel, onQueuePending]);

  // Handle clear pending
  const handleClear = useCallback(async () => {
    if (disabled || isSubmitting || !hasPending) return;

    setIsSubmitting(true);
    try {
      await onClearPending();
    } finally {
      setIsSubmitting(false);
    }
  }, [disabled, isSubmitting, hasPending, onClearPending]);

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      {/* Pending indicator */}
      {hasPending && (
        <div className="px-3 sm:px-4 py-2 bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-800/50">
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1 min-w-0">
              {hasPendingMessage && (
                <p className="text-xs text-yellow-800 dark:text-yellow-200 truncate">
                  <span className="font-medium">Queued message:</span> {pendingPrompt}
                </p>
              )}
              {hasPendingModel && (
                <p className="text-xs text-yellow-800 dark:text-yellow-200">
                  <span className="font-medium">Model change:</span> {getModelDisplayName(pendingModelKey)}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={handleClear}
              disabled={disabled || isSubmitting}
              className="flex-shrink-0 text-xs text-yellow-700 dark:text-yellow-300 hover:text-yellow-900 dark:hover:text-yellow-100 disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Action bar form */}
      <form onSubmit={handleSubmit} className="p-3 sm:p-4">
        <div className="flex flex-row gap-2 sm:gap-3">
          {/* Model selector */}
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={disabled || isSubmitting || modelsLoading}
            className="w-auto min-w-32 flex-shrink sm:w-48 h-9 text-sm rounded-md border border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
          >
            {modelsLoading ? (
              <option value="">Loading...</option>
            ) : (
              <>
                <option value="">
                  {currentModelKey ? getModelDisplayName(currentModelKey) : "Select model..."}
                </option>
                {/* Connected providers first */}
                {connectedProviders.map((provider) => {
                  const providerModels = modelsByProvider[provider] ?? [];
                  return (
                    <optgroup key={provider} label={`${provider}`}>
                      {providerModels.map((model) => {
                        const modelKey = `${model.providerID}:${model.modelID}`;
                        const isCurrent = modelKey === currentModelKey;
                        return (
                          <option
                            key={modelKey}
                            value={modelKey}
                            disabled={isCurrent}
                          >
                            {model.modelName}{isCurrent ? " (current)" : ""}
                          </option>
                        );
                      })}
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

          {/* Message input */}
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Send a message to steer the agent..."
            disabled={disabled || isSubmitting}
            className="flex-1 min-w-0 h-9 text-sm px-3 rounded-md border border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
          />

          {/* Submit button */}
          <Button
            type="submit"
            size="sm"
            disabled={disabled || isSubmitting || !hasLocalChanges}
            loading={isSubmitting}
            className="flex-shrink-0 h-9"
          >
            Queue
          </Button>
        </div>

        <p className="hidden sm:block mt-2 text-xs text-gray-500 dark:text-gray-400">
          Message will be sent after current step completes. Model change takes effect on next prompt.
        </p>
      </form>
    </div>
  );
}
