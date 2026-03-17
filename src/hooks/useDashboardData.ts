/**
 * Custom hook for Dashboard data fetching.
 * Manages config, health/version, models, branches, and planning directory state.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { AppConfig, ModelInfo, HealthResponse, BranchInfo } from "../types";
import { appFetch, setConfiguredPublicBasePath } from "../lib/public-path";
import { useToast } from "./useToast";
import { createLogger } from "../lib/logger";

const log = createLogger("useDashboardData");

export interface UseDashboardDataResult {
  // Config
  remoteOnly: boolean;
  version: string | null;

  // Models
  models: ModelInfo[];
  modelsLoading: boolean;
  lastModel: { providerID: string; modelID: string } | null;
  setLastModel: (model: { providerID: string; modelID: string } | null) => void;
  modelsWorkspaceId: string | null;

  // Planning
  planningWarning: string | null;

  // Branches
  branches: BranchInfo[];
  branchesLoading: boolean;
  currentBranch: string;
  defaultBranch: string;

  // App settings
  appSettingsResetting: boolean;
  appSettingsKilling: boolean;
  resetAllSettings: () => Promise<boolean>;
  killServer: () => Promise<boolean>;

  // Workspace change handler
  handleWorkspaceChange: (workspaceId: string | null, directory: string) => void;

  // Reset state when modal closes
  resetCreateModalState: () => void;
}

export function useDashboardData(): UseDashboardDataResult {
  const toast = useToast();

  // Config state
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [version, setVersion] = useState<string | null>(null);

  // App settings state
  const [appSettingsResetting, setAppSettingsResetting] = useState(false);
  const [appSettingsKilling, setAppSettingsKilling] = useState(false);

  // Model state
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [lastModel, setLastModel] = useState<{ providerID: string; modelID: string } | null>(null);
  const [modelsWorkspaceId, setModelsWorkspaceId] = useState<string | null>(null);

  // Planning state
  const [planningWarning, setPlanningWarning] = useState<string | null>(null);

  // Branch state
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [currentBranch, setCurrentBranch] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("");
  const modelsRequestIdRef = useRef(0);
  const branchesRequestIdRef = useRef(0);
  const defaultBranchRequestIdRef = useRef(0);
  const planningRequestIdRef = useRef(0);

  // Fetch app config on mount
  useEffect(() => {
    appFetch("/api/config")
      .then((res) => res.json())
      .then((config: AppConfig) => {
        setConfiguredPublicBasePath(config.publicBasePath || undefined);
        setRemoteOnly(config.remoteOnly);
      })
      .catch(() => {
        // Ignore errors, default to false
      });
  }, []);

  // Fetch version on mount
  useEffect(() => {
    appFetch("/api/health")
      .then((res) => res.json())
      .then((data: HealthResponse) => {
        setVersion(data.version);
      })
      .catch(() => {
        // Ignore errors
      });
  }, []);

  // Fetch last model on mount
  useEffect(() => {
    async function fetchLastModel() {
      try {
        const response = await appFetch("/api/preferences/last-model");
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

  // Reset all settings
  const resetAllSettings = useCallback(async () => {
    setAppSettingsResetting(true);
    try {
      const response = await appFetch("/api/settings/reset-all", { method: "POST" });
      if (!response.ok) {
        toast.error("Failed to reset settings");
      }
      return response.ok;
    } catch (error) {
      log.error("Failed to reset settings:", error);
      toast.error("Failed to reset settings");
      return false;
    } finally {
      setAppSettingsResetting(false);
    }
  }, []);

  // Kill server
  const killServer = useCallback(async () => {
    setAppSettingsKilling(true);
    try {
      const response = await appFetch("/api/server/kill", { method: "POST" });
      if (!response.ok) {
        log.error("Failed to kill server: HTTP", response.status);
        toast.error("Failed to kill server");
      }
      return response.ok;
    } catch (error) {
      log.error("Failed to kill server:", error);
      toast.error("Failed to kill server");
      return false;
    } finally {
      setAppSettingsKilling(false);
    }
  }, []);

  // Fetch models when directory changes
  const fetchModels = useCallback(async (directory: string, workspaceId: string | null) => {
    const requestId = ++modelsRequestIdRef.current;
    if (!directory || !workspaceId) {
      setModels([]);
      setModelsLoading(false);
      return;
    }

    setModelsLoading(true);
    try {
      const response = await appFetch(`/api/models?directory=${encodeURIComponent(directory)}&workspaceId=${encodeURIComponent(workspaceId)}`);
      if (requestId !== modelsRequestIdRef.current) {
        return;
      }
      if (response.ok) {
        const data = await response.json() as ModelInfo[];
        if (requestId !== modelsRequestIdRef.current) {
          return;
        }
        setModels(data);
      } else {
        setModels([]);
      }
    } catch {
      if (requestId === modelsRequestIdRef.current) {
        setModels([]);
      }
    } finally {
      if (requestId === modelsRequestIdRef.current) {
        setModelsLoading(false);
      }
    }
  }, []);

  // Check planning directory
  const checkPlanningDir = useCallback(async (directory: string, workspaceId: string | null) => {
    const requestId = ++planningRequestIdRef.current;
    if (!directory || !workspaceId) {
      setPlanningWarning(null);
      return;
    }

    try {
      const response = await appFetch(
        `/api/check-planning-dir?directory=${encodeURIComponent(directory)}&workspaceId=${encodeURIComponent(workspaceId)}`
      );
      if (requestId !== planningRequestIdRef.current) {
        return;
      }
      if (response.ok) {
        const data = await response.json();
        if (requestId !== planningRequestIdRef.current) {
          return;
        }
        setPlanningWarning(data.warning ?? null);
      } else {
        setPlanningWarning(null);
      }
    } catch {
      if (requestId === planningRequestIdRef.current) {
        setPlanningWarning(null);
      }
    }
  }, []);

  // Fetch branches
  const fetchBranches = useCallback(async (directory: string, workspaceId: string | null) => {
    const requestId = ++branchesRequestIdRef.current;
    if (!directory || !workspaceId) {
      setBranches([]);
      setCurrentBranch("");
      setBranchesLoading(false);
      return;
    }

    setBranchesLoading(true);
    try {
      const response = await appFetch(
        `/api/git/branches?directory=${encodeURIComponent(directory)}&workspaceId=${encodeURIComponent(workspaceId)}`
      );
      if (requestId !== branchesRequestIdRef.current) {
        return;
      }
      if (response.ok) {
        const data = await response.json();
        if (requestId !== branchesRequestIdRef.current) {
          return;
        }
        setBranches(data.branches ?? []);
        setCurrentBranch(data.currentBranch ?? "");
      } else {
        setBranches([]);
        setCurrentBranch("");
      }
    } catch {
      if (requestId === branchesRequestIdRef.current) {
        setBranches([]);
        setCurrentBranch("");
      }
    } finally {
      if (requestId === branchesRequestIdRef.current) {
        setBranchesLoading(false);
      }
    }
  }, []);

  // Fetch default branch
  const fetchDefaultBranch = useCallback(async (directory: string, workspaceId: string | null) => {
    const requestId = ++defaultBranchRequestIdRef.current;
    if (!directory || !workspaceId) {
      setDefaultBranch("");
      return;
    }

    try {
      const response = await appFetch(
        `/api/git/default-branch?directory=${encodeURIComponent(directory)}&workspaceId=${encodeURIComponent(workspaceId)}`
      );
      if (requestId !== defaultBranchRequestIdRef.current) {
        return;
      }
      if (response.ok) {
        const data = await response.json();
        if (requestId !== defaultBranchRequestIdRef.current) {
          return;
        }
        setDefaultBranch(data.defaultBranch ?? "");
      } else {
        setDefaultBranch("");
      }
    } catch {
      if (requestId === defaultBranchRequestIdRef.current) {
        setDefaultBranch("");
      }
    }
  }, []);

  // Handle workspace change
  const handleWorkspaceChange = useCallback((workspaceId: string | null, directory: string) => {
    log.debug("handleWorkspaceChange called", {
      workspaceId,
      directory,
      modelsWorkspaceId,
    });
    setModelsWorkspaceId(workspaceId);
    log.debug("Fetching workspace data with directory:", directory);
    fetchModels(directory, workspaceId);
    fetchBranches(directory, workspaceId);
    fetchDefaultBranch(directory, workspaceId);
    checkPlanningDir(directory, workspaceId);
  }, [modelsWorkspaceId, fetchModels, checkPlanningDir, fetchBranches, fetchDefaultBranch]);

  // Reset state when create modal closes
  const resetCreateModalState = useCallback(() => {
    setModels([]);
    setModelsWorkspaceId(null);
    setPlanningWarning(null);
    setBranches([]);
    setCurrentBranch("");
    setDefaultBranch("");
  }, []);

  return {
    remoteOnly,
    version,
    models,
    modelsLoading,
    lastModel,
    setLastModel,
    modelsWorkspaceId,
    planningWarning,
    branches,
    branchesLoading,
    currentBranch,
    defaultBranch,
    appSettingsResetting,
    appSettingsKilling,
    resetAllSettings,
    killServer,
    handleWorkspaceChange,
    resetCreateModalState,
  };
}
