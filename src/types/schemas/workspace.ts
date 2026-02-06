/**
 * Zod schemas for workspace-related API requests.
 *
 * These schemas validate request bodies for workspace CRUD and
 * server settings operations.
 *
 * @module types/schemas/workspace
 */

import { z } from "zod";

/**
 * Schema for ServerMode enum.
 */
export const ServerModeSchema = z.enum(["spawn", "connect"]);

/**
 * Schema for ServerSettings - server connection configuration.
 *
 * Matches the ServerSettings interface in types/settings.ts.
 */
export const ServerSettingsSchema = z.object({
  mode: ServerModeSchema,
  hostname: z.string().optional(),
  port: z.number().optional(),
  password: z.string().optional(),
  useHttps: z.boolean(),
  allowInsecure: z.boolean(),
});

/**
 * Schema for CreateWorkspaceRequest - POST /api/workspaces
 *
 * serverSettings is optional - defaults to getDefaultServerSettings() if not provided.
 * The CreateWorkspaceRequest type in types/workspace.ts is derived from this schema.
 */
export const CreateWorkspaceRequestSchema = z.object({
  name: z.string().min(1, "name is required"),
  directory: z.string().min(1, "directory is required"),
  serverSettings: ServerSettingsSchema.optional(),
});

/**
 * Schema for UpdateWorkspaceRequest - PUT /api/workspaces/:id
 *
 * All fields are optional.
 * The UpdateWorkspaceRequest type in types/workspace.ts is derived from this schema.
 */
export const UpdateWorkspaceRequestSchema = z.object({
  name: z.string().optional(),
  serverSettings: ServerSettingsSchema.optional(),
});

/**
 * Schema for testing connection without a workspace - POST /api/server-settings/test
 */
export const TestConnectionRequestSchema = z.object({
  settings: ServerSettingsSchema,
  directory: z.string().min(1, "directory is required"),
});

// Export inferred types
export type ServerSettingsInput = z.infer<typeof ServerSettingsSchema>;
export type CreateWorkspaceRequestInput = z.infer<typeof CreateWorkspaceRequestSchema>;
export type UpdateWorkspaceRequestInput = z.infer<typeof UpdateWorkspaceRequestSchema>;
export type TestConnectionRequestInput = z.infer<typeof TestConnectionRequestSchema>;
