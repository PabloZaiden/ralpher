/**
 * Dashboard component showing all loops in a grid view.
 */

import { useState, useCallback, useEffect } from "react";
import type { UncommittedChangesError, ModelInfo } from "../types";
import type { BranchInfo } from "./CreateLoopForm";
import { useLoops, useServerSettings } from "../hooks";
import { Button, Modal } from "./common";
import { LoopCard } from "./LoopCard";
import { CreateLoopForm } from "./CreateLoopForm";
import { ConnectionStatusBar } from "./ConnectionStatusBar";
import { ServerSettingsModal } from "./ServerSettingsModal";
import {
  AcceptLoopModal,
  DeleteLoopModal,
  PurgeLoopModal,
  UncommittedChangesModal,
} from "./LoopModals";

export interface DashboardProps {
  /** Callback when a loop is selected */
  onSelectLoop?: (loopId: string) => void;
}

export function Dashboard({ onSelectLoop }: DashboardProps) {
  const {
    loops,
    loading,
    error,
    connectionStatus,
    createLoop,
    startLoop,
    stopLoop,
    deleteLoop,
    acceptLoop,
    pushLoop,
    purgeLoop,
  } = useLoops();

  // Server settings state
  const {
    settings: serverSettings,
    status: serverStatus,
    loading: serverLoading,
    saving: serverSaving,
    testing: serverTesting,
    updateSettings: updateServerSettings,
    testConnection: testServerConnection,
  } = useServerSettings();
  const [showServerSettingsModal, setShowServerSettingsModal] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; loopId: string | null }>({
    open: false,
    loopId: null,
  });
  const [acceptModal, setAcceptModal] = useState<{ open: boolean; loopId: string | null }>({
    open: false,
    loopId: null,
  });
  const [purgeModal, setPurgeModal] = useState<{ open: boolean; loopId: string | null }>({
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

  // Model selection state
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [lastModel, setLastModel] = useState<{ providerID: string; modelID: string } | null>(null);
  const [modelsDirectory, setModelsDirectory] = useState("");

  // Planning directory check state
  const [planningWarning, setPlanningWarning] = useState<string | null>(null);

  // Branch selection state
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [currentBranch, setCurrentBranch] = useState("");

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

  // Fetch branches when directory changes
  const fetchBranches = useCallback(async (directory: string) => {
    if (!directory) {
      setBranches([]);
      setCurrentBranch("");
      return;
    }

    setBranchesLoading(true);
    try {
      const response = await fetch(`/api/git/branches?directory=${encodeURIComponent(directory)}`);
      if (response.ok) {
        const data = await response.json();
        setBranches(data.branches ?? []);
        setCurrentBranch(data.currentBranch ?? "");
      } else {
        setBranches([]);
        setCurrentBranch("");
      }
    } catch {
      setBranches([]);
      setCurrentBranch("");
    } finally {
      setBranchesLoading(false);
    }
  }, []);

  // Handle directory change from form
  // Fetch branches, models, and check planning dir for both spawn and connect modes (unified via PTY+WebSocket)
  const handleDirectoryChange = useCallback((directory: string) => {
    if (directory !== modelsDirectory) {
      setModelsDirectory(directory);
      fetchModels(directory);
      fetchBranches(directory);
      checkPlanningDir(directory);
    }
  }, [modelsDirectory, fetchModels, checkPlanningDir, fetchBranches]);

  // Reset model state when modal closes
  const handleCloseCreateModal = useCallback(() => {
    setShowCreateModal(false);
    setModels([]);
    setModelsDirectory("");
    setPlanningWarning(null);
    setBranches([]);
    setCurrentBranch("");
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
  async function handleUncommittedCommit() {
    if (!uncommittedModal.loopId) return;
    await startLoop(uncommittedModal.loopId, { handleUncommitted: "commit" });
    setUncommittedModal({ open: false, loopId: null, error: null });
  }

  async function handleUncommittedStash() {
    if (!uncommittedModal.loopId) return;
    await startLoop(uncommittedModal.loopId, { handleUncommitted: "stash" });
    setUncommittedModal({ open: false, loopId: null, error: null });
  }

  // Handle delete
  async function handleDelete() {
    if (!deleteModal.loopId) return;
    await deleteLoop(deleteModal.loopId);
    setDeleteModal({ open: false, loopId: null });
  }

  // Handle accept
  async function handleAccept() {
    if (!acceptModal.loopId) return;
    await acceptLoop(acceptModal.loopId);
    setAcceptModal({ open: false, loopId: null });
  }

  // Handle push
  async function handlePush() {
    if (!acceptModal.loopId) return;
    await pushLoop(acceptModal.loopId);
    setAcceptModal({ open: false, loopId: null });
  }

  // Handle purge
  async function handlePurge() {
    if (!purgeModal.loopId) return;
    await purgeLoop(purgeModal.loopId);
    setPurgeModal({ open: false, loopId: null });
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
    (loop) => loop.state.status === "merged" || loop.state.status === "pushed" || loop.state.status === "deleted"
  );
  const otherLoops = loops.filter(
    (loop) =>
      !["running", "waiting", "starting", "completed", "merged", "pushed", "deleted"].includes(
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
              {/* Server Settings */}
              <ConnectionStatusBar
                settings={serverSettings}
                status={serverStatus}
                loading={serverLoading}
                onClick={() => setShowServerSettingsModal(true)}
              />
              {/* WebSocket Status indicator - Ralpher connection */}
              <div className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-md bg-gray-100 dark:bg-gray-800">
                <span className="text-gray-500 dark:text-gray-400 font-medium">Ralpher:</span>
                <span
                  className={`h-2 w-2 rounded-full ${
                    connectionStatus === "open"
                      ? "bg-green-500"
                      : connectionStatus === "connecting"
                      ? "bg-yellow-500"
                      : "bg-red-500"
                  }`}
                />
                <span className="text-gray-700 dark:text-gray-300">
                  {connectionStatus === "open"
                    ? "Connected"
                    : connectionStatus === "connecting"
                    ? "Connecting..."
                    : "Disconnected"}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => setShowCreateModal(true)}>
                New Loop
              </Button>
            </div>
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
                    setDeleteModal({ open: true, loopId: loop.config.id })
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
                  onAccept={() => setAcceptModal({ open: true, loopId: loop.config.id })}
                  onDelete={() =>
                    setDeleteModal({ open: true, loopId: loop.config.id })
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
                  onAccept={() => setAcceptModal({ open: true, loopId: loop.config.id })}
                  onDelete={() =>
                    setDeleteModal({ open: true, loopId: loop.config.id })
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
                  onPurge={() => setPurgeModal({ open: true, loopId: loop.config.id })}
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
          branches={branches}
          branchesLoading={branchesLoading}
          currentBranch={currentBranch}
        />
      </Modal>

      {/* Delete confirmation modal */}
      <DeleteLoopModal
        isOpen={deleteModal.open}
        onClose={() => setDeleteModal({ open: false, loopId: null })}
        onDelete={handleDelete}
      />

      {/* Accept/Push modal */}
      <AcceptLoopModal
        isOpen={acceptModal.open}
        onClose={() => setAcceptModal({ open: false, loopId: null })}
        onAccept={handleAccept}
        onPush={handlePush}
      />

      {/* Purge confirmation modal */}
      <PurgeLoopModal
        isOpen={purgeModal.open}
        onClose={() => setPurgeModal({ open: false, loopId: null })}
        onPurge={handlePurge}
      />

      {/* Uncommitted changes modal */}
      <UncommittedChangesModal
        isOpen={uncommittedModal.open}
        onClose={() => setUncommittedModal({ open: false, loopId: null, error: null })}
        error={uncommittedModal.error}
        onCommit={handleUncommittedCommit}
        onStash={handleUncommittedStash}
      />

      {/* Server Settings modal */}
      <ServerSettingsModal
        isOpen={showServerSettingsModal}
        onClose={() => setShowServerSettingsModal(false)}
        settings={serverSettings}
        status={serverStatus}
        onSave={updateServerSettings}
        onTest={testServerConnection}
        saving={serverSaving}
        testing={serverTesting}
      />
    </div>
  );
}

export default Dashboard;
