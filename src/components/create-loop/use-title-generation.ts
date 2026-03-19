/**
 * useTitleGeneration — manages auto-generated loop title state.
 */

import { useState, useCallback } from "react";
import { createLogger } from "../../lib/logger";
import { useToast } from "../../hooks";
import { generateLoopTitleApi } from "../../hooks/loopActions";

const log = createLogger("CreateLoopForm");

export interface UseTitleGenerationReturn {
  generatingTitle: boolean;
  handleGenerateTitle: () => Promise<void>;
}

export function useTitleGeneration({
  selectedWorkspaceId,
  nameRef,
  promptRef,
  setName,
}: {
  selectedWorkspaceId: string | undefined;
  nameRef: React.MutableRefObject<string>;
  promptRef: React.MutableRefObject<string>;
  setName: (v: string) => void;
}): UseTitleGenerationReturn {
  const [generatingTitle, setGeneratingTitle] = useState(false);
  const toast = useToast();

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
  }, [selectedWorkspaceId, nameRef, promptRef, setName, toast]);

  return { generatingTitle, handleGenerateTitle };
}
