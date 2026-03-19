import type { LoopConfig, LoopState } from "../../types/loop";
import type { EntityLabels } from "../../utils";
import { formatModelDisplay } from "./types";

interface PromptTabProps {
  config: LoopConfig;
  state: LoopState;
  labels: EntityLabels;
  isActive: boolean;
}

export function PromptTab({ config, state, labels, isActive }: PromptTabProps) {
  return (
    <div className="flex min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 dark-scrollbar">
      <div className="min-w-0 w-full space-y-6">
        {/* Original Task Prompt (read-only) */}
        <div>
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
            Original Task Prompt
          </h3>
          <pre className="whitespace-pre-wrap break-words text-sm text-gray-900 dark:text-gray-100 font-mono bg-gray-50 dark:bg-neutral-900 rounded-md p-4 [overflow-wrap:anywhere]">
            {config.prompt || "No prompt specified."}
          </pre>
        </div>

        {/* Pending prompt status (read-only) */}
        {state.pendingPrompt && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
            <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-200 mb-2">
              Queued Message
            </h3>
            <pre className="whitespace-pre-wrap break-words text-sm text-yellow-700 dark:text-yellow-300 font-mono [overflow-wrap:anywhere]">
              {state.pendingPrompt}
            </pre>
            <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-2">
              This message will be sent after the current step completes.
            </p>
          </div>
        )}

        {/* Pending model status (read-only) */}
        {state.pendingModel && (
          <div className="bg-gray-50 dark:bg-neutral-900/40 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
              Model Change Queued
            </h3>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Model will change to <span className="font-mono font-medium">{formatModelDisplay(state.pendingModel)}</span> after the current step.
            </p>
          </div>
        )}

        {/* Tip for using action bar */}
        {isActive && !state.pendingPrompt && !state.pendingModel && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Use the action bar at the bottom to send a message or change the model while the {labels.singular} is running.
          </p>
        )}

        {/* Info message when loop is not running */}
        {!isActive && !state.pendingPrompt && !state.pendingModel && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Messages can only be queued while the {labels.singular} is running.
          </p>
        )}
      </div>
    </div>
  );
}
