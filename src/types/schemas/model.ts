/**
 * Zod schemas for model-related types.
 *
 * These schemas validate ModelConfig and related structures used across
 * multiple API endpoints.
 *
 * @module types/schemas/model
 */

import { z } from "zod";

/**
 * Schema for ModelConfig - AI model configuration.
 *
 * Matches the ModelConfig interface in types/loop.ts:
 * - providerID: Required non-empty string
 * - modelID: Required non-empty string
 * - variant: Optional string (empty string or undefined for default)
 */
export const ModelConfigSchema = z.object({
  providerID: z.string().min(1, "providerID is required and must be a non-empty string"),
  modelID: z.string().min(1, "modelID is required and must be a non-empty string"),
  variant: z.string().optional(),
});

/**
 * Inferred type from ModelConfigSchema.
 * Structurally identical to ModelConfig in types/loop.ts.
 */
export type ModelConfigInput = z.infer<typeof ModelConfigSchema>;
