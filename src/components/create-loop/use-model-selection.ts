/**
 * useModelSelection — manages model selection state for CreateLoopForm.
 *
 * Picks the initial model from initialLoopData, lastModel, or the first
 * connected model, and exposes state for user overrides.
 */

import { useState, useEffect } from "react";
import { makeModelKey, modelVariantExists } from "../ModelSelector";
import { createLogger } from "../../lib/logger";
import type { CreateLoopFormProps } from "./types";

const log = createLogger("CreateLoopForm");

type InitialLoopData = CreateLoopFormProps["initialLoopData"];

export interface UseModelSelectionReturn {
  selectedModel: string;
  setSelectedModel: (v: string) => void;
}

export function useModelSelection({
  models,
  lastModel,
  initialLoopData,
}: {
  models: CreateLoopFormProps["models"];
  lastModel: CreateLoopFormProps["lastModel"];
  initialLoopData: InitialLoopData;
}): UseModelSelectionReturn {
  const [selectedModel, setSelectedModel] = useState<string>("");

  // Set initial model when lastModel, models, or initialLoopData change
  useEffect(() => {
    log.debug("useEffect 2 - model selection", {
      selectedModel,
      lastModel,
      modelsCount: models?.length ?? 0,
      initialLoopDataModel: initialLoopData?.model,
    });
    if (selectedModel) return; // Don't override if user already selected

    if (initialLoopData?.model && models && models.length > 0) {
      const variant = initialLoopData.model.variant ?? "";
      if (
        modelVariantExists(
          models,
          initialLoopData.model.providerID,
          initialLoopData.model.modelID,
          variant
        )
      ) {
        const modelKey = makeModelKey(
          initialLoopData.model.providerID,
          initialLoopData.model.modelID,
          variant
        );
        log.debug("Setting model from initialLoopData:", modelKey);
        setSelectedModel(modelKey);
        return;
      }
    }

    if (lastModel && models && models.length > 0) {
      const variant = lastModel.variant ?? "";
      if (modelVariantExists(models, lastModel.providerID, lastModel.modelID, variant)) {
        const modelKey = makeModelKey(lastModel.providerID, lastModel.modelID, variant);
        log.debug("Setting model from lastModel:", modelKey);
        setSelectedModel(modelKey);
        return;
      }
    }

    // Default to first connected model (with first variant or empty variant)
    const firstConnected = models?.find((m) => m.connected);
    if (firstConnected) {
      const variant =
        firstConnected.variants && firstConnected.variants.length > 0
          ? firstConnected.variants[0]
          : "";
      const modelKey = makeModelKey(firstConnected.providerID, firstConnected.modelID, variant);
      log.debug("Setting model to first connected:", modelKey);
      setSelectedModel(modelKey);
    }
  }, [lastModel, models, selectedModel, initialLoopData]);

  return { selectedModel, setSelectedModel };
}
