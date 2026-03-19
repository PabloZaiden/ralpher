/**
 * Hook for fetching available models for a workspace directory in LoopDetails.
 */

import { useEffect, useState } from "react";
import type { ModelInfo } from "../../types";
import { log } from "../../lib/logger";
import { appFetch } from "../../lib/public-path";

interface UseModelsOptions {
  directory: string | undefined;
  workspaceId: string | undefined;
}

interface UseModelsResult {
  models: ModelInfo[];
  modelsLoading: boolean;
}

export function useModels({ directory, workspaceId }: UseModelsOptions): UseModelsResult {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  useEffect(() => {
    if (!directory || !workspaceId) return;

    const controller = new AbortController();

    async function fetchModels() {
      setModelsLoading(true);
      try {
        const response = await appFetch(
          `/api/models?directory=${encodeURIComponent(directory!)}&workspaceId=${encodeURIComponent(workspaceId!)}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (response.ok) {
          const data = await response.json() as ModelInfo[];
          if (controller.signal.aborted) return;
          setModels(data);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        log.error("Failed to fetch models:", String(error));
      } finally {
        if (!controller.signal.aborted) {
          setModelsLoading(false);
        }
      }
    }

    void fetchModels();

    return () => {
      controller.abort();
    };
  }, [directory, workspaceId]);

  return { models, modelsLoading };
}
