/**
 * Terminal-state loop purge panel within workspace settings.
 */

import { useState } from "react";
import { Button, Badge, ConfirmModal } from "../common";
import type { PurgeArchivedLoopsResult } from "../../hooks";
import type { Workspace } from "../../types/workspace";
import { TrashIcon } from "./icons";

interface PurgeLoopsSectionProps {
  workspace: Workspace;
  onPurgeArchivedLoops: () => Promise<PurgeArchivedLoopsResult>;
  purgeableLoopCount: number;
  purgingPurgeableLoops: boolean;
}

export function PurgeLoopsSection({
  workspace,
  onPurgeArchivedLoops,
  purgeableLoopCount,
  purgingPurgeableLoops,
}: PurgeLoopsSectionProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [purgeResult, setPurgeResult] = useState<PurgeArchivedLoopsResult | null>(null);
  const [purgeError, setPurgeError] = useState<string | null>(null);

  async function handlePurge() {
    setPurgeResult(null);
    setPurgeError(null);
    try {
      const result = await onPurgeArchivedLoops();
      if (!result.success) {
        setShowConfirm(false);
        setPurgeError("Failed to purge terminal-state loops.");
        return;
      }

      setPurgeResult(result);
      setShowConfirm(false);
    } catch (error) {
      setShowConfirm(false);
      setPurgeError(`Failed to purge terminal-state loops: ${String(error)}`);
    }
  }

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 pt-6 mt-6">
      <div className="p-4 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/20">
        <div className="flex items-center justify-between gap-3 mb-2">
          <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
            Loops in a Terminal State
          </h3>
          <Badge variant={purgeableLoopCount > 0 ? "warning" : "default"} size="sm">
            {purgeableLoopCount} purgeable
          </Badge>
        </div>
        <p className="text-sm text-red-700 dark:text-red-300 mb-4">
          Permanently delete loops in a terminal state for this workspace once they are no longer awaiting feedback. This currently applies to merged, pushed, and deleted loops. This removes their loop data and cannot be undone.
        </p>

        {purgeError && (
          <div className="mb-3 p-3 rounded-md bg-red-100 dark:bg-red-950/40 border border-red-200 dark:border-red-900">
            <p className="text-sm text-red-700 dark:text-red-300">{purgeError}</p>
          </div>
        )}

        {purgeResult && (
          <div className={`mb-3 p-3 rounded-md border ${
            purgeResult.failures.length > 0
              ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-900"
              : "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-900"
          }`}>
            <p className={`text-sm ${
              purgeResult.failures.length > 0
                ? "text-amber-700 dark:text-amber-300"
                : "text-green-700 dark:text-green-300"
            }`}>
              {purgeResult.totalArchived === 0
                ? "No loops in a terminal state were found for this workspace."
                : purgeResult.failures.length > 0
                  ? `Purged ${purgeResult.purgedCount} of ${purgeResult.totalArchived} terminal-state loops.`
                  : `Purged ${purgeResult.purgedCount} terminal-state loops.`}
            </p>
            {purgeResult.failures.length > 0 && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                Failed loop IDs: {purgeResult.failures.map((failure) => failure.loopId).join(", ")}
              </p>
            )}
          </div>
        )}

        <Button
          type="button"
          variant="danger"
          size="sm"
          onClick={() => setShowConfirm(true)}
          disabled={purgingPurgeableLoops || purgeableLoopCount === 0}
          loading={purgingPurgeableLoops}
        >
          <TrashIcon className="w-4 h-4 mr-2" />
          Purge Terminal-State Loops
        </Button>
      </div>

      <ConfirmModal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handlePurge}
        title="Purge Terminal-State Loops"
        message={`Are you sure you want to permanently delete all ${purgeableLoopCount} loops in a terminal state for "${workspace.name}"? This currently applies to merged, pushed, and deleted loops and cannot be undone.`}
        confirmLabel="Purge All"
        loading={purgingPurgeableLoops}
        variant="danger"
      />
    </div>
  );
}
