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
 * Agent provider options.
 */
export const AgentProviderSchema = z.enum(["opencode", "copilot"]);

/**
 * Agent transport options.
 */
export const AgentTransportSchema = z.enum(["stdio", "tcp", "ssh-stdio"]);

/**
 * Execution provider options.
 */
export const ExecutionProviderSchema = z.enum(["local", "ssh"]);

/**
 * Schema for the agent channel settings.
 */
export const AgentSettingsSchema = z.object({
  provider: AgentProviderSchema,
  transport: AgentTransportSchema,
  hostname: z.string().optional(),
  port: z.number().optional(),
  password: z.string().optional(),
  useHttps: z.boolean(),
  allowInsecure: z.boolean(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
});

/**
 * Schema for the deterministic execution channel settings.
 */
export const ExecutionSettingsSchema = z.object({
  provider: ExecutionProviderSchema,
  host: z.string().optional(),
  port: z.number().optional(),
  user: z.string().optional(),
  workspaceRoot: z.string().optional(),
});

/**
 * Schema for workspace server settings.
 *
 * This schema is the single source of truth. The ServerSettings type is inferred from it.
 * The settings are split into two channels:
 * - agent: ACP-compatible agent runtime settings
 * - execution: deterministic command/file execution settings
 */
export const ServerSettingsSchema = z.object({
  agent: AgentSettingsSchema,
  execution: ExecutionSettingsSchema,
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
export type AgentProvider = z.infer<typeof AgentProviderSchema>;
export type AgentTransport = z.infer<typeof AgentTransportSchema>;
export type ExecutionProvider = z.infer<typeof ExecutionProviderSchema>;
export type AgentSettings = z.infer<typeof AgentSettingsSchema>;
export type ExecutionSettings = z.infer<typeof ExecutionSettingsSchema>;
export type ServerSettings = z.infer<typeof ServerSettingsSchema>;

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;
export type WorkspaceExportData = z.infer<typeof WorkspaceExportSchema>;
export type WorkspaceImportRequest = z.infer<typeof WorkspaceImportRequestSchema>;
