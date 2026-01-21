/**
 * Dashboard component showing all loops in a grid view.
 */

import { useState, useCallback, useEffect } from "react";
import type { UncommittedChangesError, ModelInfo } from "../types";
import { useLoops } from "../hooks";
import { Button, ConfirmModal, Modal } from "./common";
import { LoopCard } from "./LoopCard";
import { CreateLoopForm } from "./CreateLoopForm";

export interface DashboardProps {
  /** Callback when a loop is selected */
  onSelectLoop?: (loopId: string) => void;
}

export function Dashboard({ onSelectLoop }: DashboardProps) {
  const {
    loops,
    loading,
    error,
    sseStatus,
    createLoop,
    startLoop,
    stopLoop,
    deleteLoop,
    acceptLoop,
    purgeLoop,
  } = useLoops();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; loopId: string | null }>({
    open: false,
    loopId: null,
  });
  const [acceptConfirm, setAcceptConfirm] = useState<{ open: boolean; loopId: string | null }>({
    open: false,
    loopId: null,
  });
  const [purgeConfirm, setPurgeConfirm] = useState<{ open: boolean; loopId: string | null }>({
    open: false,
    loopId: null,
  });
  const [uncommittedModal, setUncommittedModal] = useState<{
    open: boolean;
    loopId: string | null;
    error: UncommittedChangesError | null;
  }>({
    open: false,
    loopId: null,
    error: null,
  });
  const [deleting, setDeleting] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [purging, setPurging] = useState(false);

  // Model selection state
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [lastModel, setLastModel] = useState<{ providerID: string; modelID: string } | null>(null);
  const [modelsDirectory, setModelsDirectory] = useState("");

  // Planning directory check state
  const [planningWarning, setPlanningWarning] = useState<string | null>(null);

  // Fetch last model on mount
  useEffect(() => {
    async function fetchLastModel() {
      try {
        const response = await fetch("/api/preferences/last-model");
        if (response.ok) {
          const data = await response.json();
          setLastModel(data);
        }
      } catch {
        // Ignore errors
      }
    }
    fetchLastModel();
  }, []);

  // Fetch models when directory changes
  const fetchModels = useCallback(async (directory: string) => {
    if (!directory) {
      setModels([]);
      return;
    }

    setModelsLoading(true);
    try {
      const response = await fetch(`/api/models?directory=${encodeURIComponent(directory)}`);
      if (response.ok) {
        const data = await response.json() as ModelInfo[];
        setModels(data);
      } else {
        setModels([]);
      }
    } catch {
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  }, []);

  // Check planning directory when directory changes
  const checkPlanningDir = useCallback(async (directory: string) => {
    if (!directory) {
      setPlanningWarning(null);
      return;
    }

    try {
      const response = await fetch(`/api/check-planning-dir?directory=${encodeURIComponent(directory)}`);
      if (response.ok) {
        const data = await response.json();
        setPlanningWarning(data.warning ?? null);
      } else {
        setPlanningWarning(null);
      }
    } catch {
      setPlanningWarning(null);
    }
  }, []);

  // Handle directory change from form
  const handleDirectoryChange = useCallback((directory: string) => {
    if (directory !== modelsDirectory) {
      setModelsDirectory(directory);
      fetchModels(directory);
      checkPlanningDir(directory);
    }
  }, [modelsDirectory, fetchModels, checkPlanningDir]);

  // Reset model state when modal closes
  const handleCloseCreateModal = useCallback(() => {
    setShowCreateModal(false);
    setModels([]);
    setModelsDirectory("");
    setPlanningWarning(null);
  }, []);

  // Handle start with uncommitted changes handling
  async function handleStart(loopId: string) {
    const result = await startLoop(loopId);
    if (result.uncommittedError) {
      setUncommittedModal({
        open: true,
        loopId,
        error: result.uncommittedError,
      });
    }
  }

  // Handle uncommitted changes decision
  async function handleUncommittedDecision(action: "commit" | "stash") {
    if (!uncommittedModal.loopId) return;
    await startLoop(uncommittedModal.loopId, { handleUncommitted: action });
    setUncommittedModal({ open: false, loopId: null, error: null });
  }

  // Handle delete confirmation
  async function handleDeleteConfirm() {
    if (!deleteConfirm.loopId) return;
    setDeleting(true);
    await deleteLoop(deleteConfirm.loopId);
    setDeleting(false);
    setDeleteConfirm({ open: false, loopId: null });
  }

  // Handle accept confirmation
  async function handleAcceptConfirm() {
    if (!acceptConfirm.loopId) return;
    setAccepting(true);
    await acceptLoop(acceptConfirm.loopId);
    setAccepting(false);
    setAcceptConfirm({ open: false, loopId: null });
  }

  // Handle purge confirmation
  async function handlePurgeConfirm() {
    if (!purgeConfirm.loopId) return;
    setPurging(true);
    await purgeLoop(purgeConfirm.loopId);
    setPurging(false);
    setPurgeConfirm({ open: false, loopId: null });
  }

  // Group loops by status
  const activeLoops = loops.filter(
    (loop) =>
      loop.state.status === "running" ||
      loop.state.status === "waiting" ||
      loop.state.status === "starting"
  );
  const completedLoops = loops.filter(
    (loop) => loop.state.status === "completed"
  );
  const archivedLoops = loops.filter(
    (loop) => loop.state.status === "merged" || loop.state.status === "deleted"
  );
  const otherLoops = loops.filter(
    (loop) =>
      !["running", "waiting", "starting", "completed", "merged", "deleted"].includes(
        loop.state.status
      )
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                Ralph Loops
              </h1>
              {/* SSE Status indicator */}
              <div className="flex items-center gap-2 text-sm">
                <span
                  className={`h-2 w-2 rounded-full ${
                    sseStatus === "open"
                      ? "bg-green-500"
                      : sseStatus === "connecting"
                      ? "bg-yellow-500"
                      : "bg-red-500"
                  }`}
                />
                <span className="text-gray-500 dark:text-gray-400">
                  {sseStatus === "open"
                    ? "Connected"
                    : sseStatus === "connecting"
                    ? "Connecting..."
                    : "Disconnected"}
                </span>
              </div>
            </div>
            <Button onClick={() => setShowCreateModal(true)}>
              New Loop
            </Button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="px-4 sm:px-6 lg:px-8 py-8">
        {/* Error display */}
        {error && (
          <div className="mb-6 rounded-md bg-red-50 dark:bg-red-900/20 p-4">
            <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* Loading state */}
        {loading && loops.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent" />
          </div>
        )}

        {/* Empty state */}
        {!loading && loops.length === 0 && (
          <div className="text-center py-12">
            <div className="text-gray-400 dark:text-gray-500 mb-4">
              <svg
                className="mx-auto h-12 w-12"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
              No loops yet
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Click "New Loop" to create your first Ralph Loop.
            </p>
          </div>
        )}

        {/* Active loops section */}
        {activeLoops.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Active ({activeLoops.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
              {activeLoops.map((loop) => (
                <LoopCard
                  key={loop.config.id}
                  loop={loop}
                  onClick={() => onSelectLoop?.(loop.config.id)}
                  onStop={() => stopLoop(loop.config.id)}
                  onDelete={() =>
                    setDeleteConfirm({ open: true, loopId: loop.config.id })
                  }
                />
              ))}
            </div>
          </section>
        )}

        {/* Completed loops section */}
        {completedLoops.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Completed ({completedLoops.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
              {completedLoops.map((loop) => (
                <LoopCard
                  key={loop.config.id}
                  loop={loop}
                  onClick={() => onSelectLoop?.(loop.config.id)}
                  onAccept={() => setAcceptConfirm({ open: true, loopId: loop.config.id })}
                  onDelete={() =>
                    setDeleteConfirm({ open: true, loopId: loop.config.id })
                  }
                />
              ))}
            </div>
          </section>
        )}

        {/* Other loops section */}
        {otherLoops.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Other ({otherLoops.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
              {otherLoops.map((loop) => (
                <LoopCard
                  key={loop.config.id}
                  loop={loop}
                  onClick={() => onSelectLoop?.(loop.config.id)}
                  onStart={() => handleStart(loop.config.id)}
                  onStop={() => stopLoop(loop.config.id)}
                  onAccept={() => setAcceptConfirm({ open: true, loopId: loop.config.id })}
                  onDelete={() =>
                    setDeleteConfirm({ open: true, loopId: loop.config.id })
                  }
                />
              ))}
            </div>
          </section>
        )}

        {/* Archived loops section (merged/deleted) */}
        {archivedLoops.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Archived ({archivedLoops.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
              {archivedLoops.map((loop) => (
                <LoopCard
                  key={loop.config.id}
                  loop={loop}
                  onClick={() => onSelectLoop?.(loop.config.id)}
                  onPurge={() => setPurgeConfirm({ open: true, loopId: loop.config.id })}
                />
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Create loop modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={handleCloseCreateModal}
        title="Create New Loop"
        description="Configure a new Ralph Loop for autonomous AI development."
        size="lg"
      >
        <CreateLoopForm
          onSubmit={async (request) => {
            const loop = await createLoop(request);
            if (loop) {
              handleCloseCreateModal();
              // Refresh last model in case it changed
              if (request.model) {
                setLastModel(request.model);
              }
            }
          }}
          onCancel={handleCloseCreateModal}
          models={models}
          modelsLoading={modelsLoading}
          lastModel={lastModel}
          onDirectoryChange={handleDirectoryChange}
          planningWarning={planningWarning}
        />
      </Modal>

      {/* Delete confirmation modal */}
      <ConfirmModal
        isOpen={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, loopId: null })}
        onConfirm={handleDeleteConfirm}
        title="Delete Loop"
        message="Are you sure you want to delete this loop? The loop will be marked as deleted and can be purged later to permanently remove it."
        confirmLabel="Delete"
        loading={deleting}
        variant="danger"
      />

      {/* Accept confirmation modal */}
      <ConfirmModal
        isOpen={acceptConfirm.open}
        onClose={() => setAcceptConfirm({ open: false, loopId: null })}
        onConfirm={handleAcceptConfirm}
        title="Accept Loop"
        message="Are you sure you want to accept this loop? This will merge the changes into the original branch. This action cannot be undone."
        confirmLabel="Accept & Merge"
        loading={accepting}
        variant="primary"
      />

      {/* Purge confirmation modal */}
      <ConfirmModal
        isOpen={purgeConfirm.open}
        onClose={() => setPurgeConfirm({ open: false, loopId: null })}
        onConfirm={handlePurgeConfirm}
        title="Purge Loop"
        message="Are you sure you want to permanently delete this loop? This will remove all loop data and cannot be undone."
        confirmLabel="Purge"
        loading={purging}
        variant="danger"
      />

      {/* Uncommitted changes modal */}
      <Modal
        isOpen={uncommittedModal.open}
        onClose={() => setUncommittedModal({ open: false, loopId: null, error: null })}
        title="Uncommitted Changes Detected"
        description="The target directory has uncommitted changes. How would you like to proceed?"
        size="md"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setUncommittedModal({ open: false, loopId: null, error: null })}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleUncommittedDecision("stash")}
            >
              Stash Changes
            </Button>
            <Button
              variant="primary"
              onClick={() => handleUncommittedDecision("commit")}
            >
              Commit Changes
            </Button>
          </>
        }
      >
        {uncommittedModal.error && (
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
              {uncommittedModal.error.message}
            </p>
            {uncommittedModal.error.changedFiles.length > 0 && (
              <div className="bg-gray-50 dark:bg-gray-900 rounded-md p-3">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Changed files:
                </p>
                <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                  {uncommittedModal.error.changedFiles.slice(0, 10).map((file) => (
                    <li key={file} className="font-mono truncate">
                      {file}
                    </li>
                  ))}
                  {uncommittedModal.error.changedFiles.length > 10 && (
                    <li className="text-gray-500">
                      ...and {uncommittedModal.error.changedFiles.length - 10} more
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

export default Dashboard;
