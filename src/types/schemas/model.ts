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
 * This schema is the single source of truth. The ModelConfig type is inferred from it.
 * - providerID: Required non-empty string (e.g., "anthropic", "openai", "bedrock")
 * - modelID: Required non-empty string (e.g., "claude-sonnet-4-20250514", "gpt-4o")
 * - variant: Optional string (e.g., "thinking", ""). Empty string or undefined for default.
 */
export const ModelConfigSchema = z.object({
  providerID: z.string().min(1, "providerID is required and must be a non-empty string"),
  modelID: z.string().min(1, "modelID is required and must be a non-empty string"),
  variant: z.string().optional(),
});

/**
 * Inferred type from ModelConfigSchema.
 * This is the single source of truth for the ModelConfig type.
 */
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

