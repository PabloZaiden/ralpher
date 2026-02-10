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
 * This schema is the single source of truth. The ServerSettings type is inferred from it.
 * - mode: Connection mode ("spawn" for local, "connect" for remote)
 * - hostname: Hostname for connect mode (optional)
 * - port: Port for connect mode (optional)
 * - password: Password for connect mode (optional)
 * - useHttps: Whether to use HTTPS for connect mode
 * - allowInsecure: Whether to allow insecure connections (self-signed certs)
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

/**
 * Schema for a single workspace config in an export file.
 * Contains only the portable configuration fields (no id/timestamps).
 */
export const WorkspaceConfigSchema = z.object({
  name: z.string().min(1, "name is required"),
  directory: z.string().min(1, "directory is required"),
  serverSettings: ServerSettingsSchema,
});

/**
 * Schema for the workspace export envelope.
 * Contains version info and an array of workspace configs.
 */
export const WorkspaceExportSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  workspaces: z.array(WorkspaceConfigSchema),
});

/**
 * Schema for the import request body - same as the export envelope.
 */
export const WorkspaceImportRequestSchema = WorkspaceExportSchema;

// Export inferred types
/**
 * ServerSettings type - inferred from ServerSettingsSchema.
 * This is the single source of truth for server connection configuration.
 */
export type ServerSettings = z.infer<typeof ServerSettingsSchema>;

// Alias for backwards compatibility
export type ServerSettingsInput = ServerSettings;

export type CreateWorkspaceRequestInput = z.infer<typeof CreateWorkspaceRequestSchema>;
export type UpdateWorkspaceRequestInput = z.infer<typeof UpdateWorkspaceRequestSchema>;
export type TestConnectionRequestInput = z.infer<typeof TestConnectionRequestSchema>;
export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;
export type WorkspaceExportData = z.infer<typeof WorkspaceExportSchema>;
export type WorkspaceImportRequest = z.infer<typeof WorkspaceImportRequestSchema>;
