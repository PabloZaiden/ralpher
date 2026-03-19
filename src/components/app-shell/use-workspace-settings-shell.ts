import { useEffect, useMemo, useState } from "react";
import type { PurgeArchivedLoopsResult } from "../../hooks";
import type { WorkspaceGroup } from "../../hooks/useLoopGrouping";
import { useWorkspaceServerSettings, type UseWorkspaceServerSettingsResult } from "../../hooks/useWorkspaceServerSettings";
import type { ShellRoute } from "./shell-types";

export interface UseWorkspaceSettingsShellResult extends UseWorkspaceServerSettingsResult {
  workspaceSettingsWorkspaceId: string | null;
  workspaceSettingsFormValid: boolean;
  setWorkspaceSettingsFormValid: (valid: boolean) => void;
  workspaceArchivedLoopsPurging: boolean;
  handlePurgeArchivedLoops: (workspaceId: string) => Promise<PurgeArchivedLoopsResult>;
  selectedWorkspaceArchivedLoopCount: number;
  selectedWorkspaceLoopCount: number;
}

interface UseWorkspaceSettingsShellOptions {
  route: ShellRoute;
  workspaceGroups: WorkspaceGroup[];
  purgeArchivedWorkspaceLoops: (workspaceId: string) => Promise<PurgeArchivedLoopsResult>;
}

export function useWorkspaceSettingsShell({
  route,
  workspaceGroups,
  purgeArchivedWorkspaceLoops,
}: UseWorkspaceSettingsShellOptions): UseWorkspaceSettingsShellResult {
  const workspaceSettingsWorkspaceId = route.view === "workspace-settings" ? route.workspaceId : null;
  const [workspaceSettingsFormValid, setWorkspaceSettingsFormValid] = useState(false);
  const [workspaceArchivedLoopsPurging, setWorkspaceArchivedLoopsPurging] = useState(false);

  const workspaceServerSettings = useWorkspaceServerSettings(workspaceSettingsWorkspaceId);

  const selectedWorkspaceArchivedLoopCount = useMemo(() => {
    if (!workspaceSettingsWorkspaceId) {
      return 0;
    }
    return (
      workspaceGroups.find((group) => group.workspace.id === workspaceSettingsWorkspaceId)?.statusGroups.archived
        .length ?? 0
    );
  }, [workspaceGroups, workspaceSettingsWorkspaceId]);

  const selectedWorkspaceLoopCount = useMemo(() => {
    if (!workspaceSettingsWorkspaceId) {
      return 0;
    }
    return workspaceGroups.find((group) => group.workspace.id === workspaceSettingsWorkspaceId)?.loops.length ?? 0;
  }, [workspaceGroups, workspaceSettingsWorkspaceId]);

  useEffect(() => {
    if (route.view !== "workspace-settings") {
      setWorkspaceSettingsFormValid(false);
    }
  }, [route.view]);

  useEffect(() => {
    setWorkspaceSettingsFormValid(false);
  }, [workspaceSettingsWorkspaceId]);

  async function handlePurgeArchivedLoops(workspaceId: string): Promise<PurgeArchivedLoopsResult> {
    try {
      setWorkspaceArchivedLoopsPurging(true);
      return await purgeArchivedWorkspaceLoops(workspaceId);
    } finally {
      setWorkspaceArchivedLoopsPurging(false);
    }
  }

  return {
    ...workspaceServerSettings,
    workspaceSettingsWorkspaceId,
    workspaceSettingsFormValid,
    setWorkspaceSettingsFormValid,
    workspaceArchivedLoopsPurging,
    handlePurgeArchivedLoops,
    selectedWorkspaceArchivedLoopCount,
    selectedWorkspaceLoopCount,
  };
}
