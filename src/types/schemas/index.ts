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
  type ModelConfigInput,
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
  type CreateLoopRequestInput,
  type UpdateLoopRequestInput,
  type AddressCommentsRequestInput,
  type PlanFeedbackRequestInput,
  type PendingPromptRequestInput,
  type SetPendingRequestInput,
  type StartDraftRequestInput,
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
  type ServerSettingsInput,
  type CreateWorkspaceRequestInput,
  type UpdateWorkspaceRequestInput,
  type TestConnectionRequestInput,
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
  type SetLastModelRequestInput,
  type SetLastDirectoryRequestInput,
  type SetMarkdownRenderingRequestInput,
  type SetLogLevelRequestInput,
} from "./preferences";
