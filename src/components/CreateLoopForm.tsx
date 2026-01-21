/**
 * CreateLoopForm component for creating new Ralph Loops.
 */

import { useState, useEffect, type FormEvent } from "react";
import type { CreateLoopRequest, ModelInfo } from "../types";
import { Button } from "./common";

export interface CreateLoopFormProps {
  /** Callback when form is submitted */
  onSubmit: (request: CreateLoopRequest) => Promise<void>;
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
  /** Callback when directory changes (to reload models) */
  onDirectoryChange?: (directory: string) => void;
}

export function CreateLoopForm({
  onSubmit,
  onCancel,
  loading = false,
  models = [],
  modelsLoading = false,
  lastModel,
  onDirectoryChange,
}: CreateLoopFormProps) {
  const [name, setName] = useState("");
  const [directory, setDirectory] = useState("");
  const [prompt, setPrompt] = useState("");
  const [maxIterations, setMaxIterations] = useState<string>("");
  const [maxConsecutiveErrors, setMaxConsecutiveErrors] = useState<string>("10");
  const [backendMode, setBackendMode] = useState<"spawn" | "connect">("spawn");
  const [hostname, setHostname] = useState("localhost");
  const [port, setPort] = useState("3000");
  const [gitEnabled, setGitEnabled] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>("");

  // Set initial model when lastModel or models change
  useEffect(() => {
    if (selectedModel) return; // Don't override if user already selected

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
  }, [lastModel, models, selectedModel]);

  // Notify parent when directory changes (debounced)
  useEffect(() => {
    if (!directory.trim() || !onDirectoryChange) return;

    const timer = setTimeout(() => {
      onDirectoryChange(directory.trim());
    }, 500);

    return () => clearTimeout(timer);
  }, [directory, onDirectoryChange]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!name.trim() || !directory.trim() || !prompt.trim()) {
      return;
    }

    setSubmitting(true);

    const request: CreateLoopRequest = {
      name: name.trim(),
      directory: directory.trim(),
      prompt: prompt.trim(),
      backend: {
        type: "opencode",
        mode: backendMode,
        ...(backendMode === "connect" && {
          hostname: hostname.trim(),
          port: parseInt(port, 10),
        }),
      },
      git: {
        enabled: gitEnabled,
      },
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

    try {
      await onSubmit(request);
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
          placeholder="Feature: Add dark mode"
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
          placeholder="Read AGENTS.md and the documents in .planning/. Continue working on the implementation..."
          required
          rows={5}
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          The prompt sent to the AI agent at the start of each iteration
        </p>
      </div>

      {/* Git toggle */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="gitEnabled"
          checked={gitEnabled}
          onChange={(e) => setGitEnabled(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <label
          htmlFor="gitEnabled"
          className="text-sm text-gray-700 dark:text-gray-300"
        >
          Enable Git integration (branch per loop, commit per iteration)
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

          {/* Backend mode */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Backend Mode
            </label>
            <div className="mt-2 flex gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="backendMode"
                  value="spawn"
                  checked={backendMode === "spawn"}
                  onChange={() => setBackendMode("spawn")}
                  className="h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Spawn new server
                </span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="backendMode"
                  value="connect"
                  checked={backendMode === "connect"}
                  onChange={() => setBackendMode("connect")}
                  className="h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Connect to existing
                </span>
              </label>
            </div>
          </div>

          {/* Connect mode options */}
          {backendMode === "connect" && (
            <div className="flex gap-4">
              <div className="flex-1">
                <label
                  htmlFor="hostname"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Hostname
                </label>
                <input
                  type="text"
                  id="hostname"
                  value={hostname}
                  onChange={(e) => setHostname(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </div>
              <div className="w-24">
                <label
                  htmlFor="port"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Port
                </label>
                <input
                  type="number"
                  id="port"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          Create Loop
        </Button>
      </div>
    </form>
  );
}

export default CreateLoopForm;
