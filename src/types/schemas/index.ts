/**
 * Schema exports for API request validation.
 *
 * This module re-exports all Zod schemas from a single entry point.
 *
 * @module types/schemas
 */

// Model schemas
export {
  ModelConfigSchema,
  type ModelConfig,
} from "./model";

// Loop schemas
export {
  GitConfigSchema,
  CreateLoopRequestSchema,
  UpdateLoopRequestSchema,
  AddressCommentsRequestSchema,
  PlanFeedbackRequestSchema,
  PendingPromptRequestSchema,
  SetPendingRequestSchema,
  StartDraftRequestSchema,
} from "./loop";

// Workspace schemas
export {
  ServerModeSchema,
  ServerSettingsSchema,
  CreateWorkspaceRequestSchema,
  UpdateWorkspaceRequestSchema,
  TestConnectionRequestSchema,
  WorkspaceConfigSchema,
  WorkspaceExportSchema,
  WorkspaceImportRequestSchema,
  type ServerSettings,
  type WorkspaceConfig,
  type WorkspaceExportData,
  type WorkspaceImportRequest,
} from "./workspace";

// Preferences schemas
export {
  SetLastModelRequestSchema,
  SetLastDirectoryRequestSchema,
  SetMarkdownRenderingRequestSchema,
  SetLogLevelRequestSchema,
} from "./preferences";
