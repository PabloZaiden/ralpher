/**
 * Zod schemas for preferences-related API requests.
 *
 * These schemas validate request bodies for user preference endpoints.
 *
 * @module types/schemas/preferences
 */

import { z } from "zod";
import { ModelConfigSchema } from "./model";

/**
 * Schema for setting last used model - PUT /api/preferences/last-model
 *
 * Uses the same ModelConfigSchema since it's the same structure.
 */
export const SetLastModelRequestSchema = ModelConfigSchema;

/**
 * Schema for setting last used directory - PUT /api/preferences/last-directory
 */
export const SetLastDirectoryRequestSchema = z.object({
  directory: z.string().min(1, "directory is required"),
});

/**
 * Schema for setting markdown rendering preference - PUT /api/preferences/markdown-rendering
 */
export const SetMarkdownRenderingRequestSchema = z.object({
  enabled: z.boolean({ error: "enabled must be a boolean" }),
});

/**
 * Schema for setting log level - PUT /api/preferences/log-level
 */
export const SetLogLevelRequestSchema = z.object({
  level: z.string().min(1, "level is required"),
});

// Export inferred types
export type SetLastModelRequestInput = z.infer<typeof SetLastModelRequestSchema>;
export type SetLastDirectoryRequestInput = z.infer<typeof SetLastDirectoryRequestSchema>;
export type SetMarkdownRenderingRequestInput = z.infer<typeof SetMarkdownRenderingRequestSchema>;
export type SetLogLevelRequestInput = z.infer<typeof SetLogLevelRequestSchema>;
