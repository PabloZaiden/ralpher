/**
 * Zod schemas for loop-related API requests.
 *
 * These schemas validate request bodies for loop CRUD and control operations.
 * They match the interfaces defined in types/api.ts.
 *
 * @module types/schemas/loop
 */

import { z } from "zod";
import { ModelConfigSchema } from "./model";

/**
 * Schema for GitConfig - git integration settings.
 * Used as a partial in CreateLoopRequest and UpdateLoopRequest.
 *
 * Accepts `commitScope` (preferred) or `commitPrefix` (deprecated alias).
 * If both are provided, `commitScope` takes precedence.
 */
export const GitConfigSchema = z.object({
  branchPrefix: z.string().optional(),
  commitScope: z.string().optional(),
  /** @deprecated Use `commitScope` instead. */
  commitPrefix: z.string().optional(),
}).transform((val) => {
  // Map deprecated commitPrefix to commitScope if commitScope is not set
  if (val.commitPrefix !== undefined && val.commitScope === undefined) {
    // Strip brackets and lowercase: "[Ralph]" -> "ralph"
    const cleaned = val.commitPrefix
      .replace(/^\[/, "")
      .replace(/\]$/, "")
      .trim()
      .toLowerCase();
    return {
      branchPrefix: val.branchPrefix,
      commitScope: cleaned || undefined,
    };
  }
  // Drop the deprecated field from the output
  // Trim commitScope and map empty/whitespace-only to undefined
  const trimmedScope = val.commitScope?.trim();
  return {
    branchPrefix: val.branchPrefix,
    commitScope: trimmedScope || undefined,
  };
});

export const LoopNameSchema = z.string().trim().min(1, "name is required");

/**
 * Schema for CreateLoopRequest - POST /api/loops
 *
 */
export const CreateLoopRequestSchema = z.object({
  name: LoopNameSchema,
  workspaceId: z.string().min(1, "workspaceId is required"),
  prompt: z.string().min(1, "prompt is required and must be a non-empty string"),
  model: ModelConfigSchema,
  maxIterations: z.number().optional(),
  maxConsecutiveErrors: z.number().optional(),
  activityTimeoutSeconds: z
    .number()
    .min(60, "activityTimeoutSeconds must be at least 60 seconds")
    .optional(),
  stopPattern: z.string().optional(),
  git: GitConfigSchema.optional(),
  baseBranch: z.string().optional(),
  useWorktree: z.boolean({ error: "useWorktree is required and must be a boolean (true or false)" }),
  clearPlanningFolder: z.boolean().optional(),
  planMode: z.boolean({ error: "planMode is required and must be a boolean (true or false)" }),
  draft: z.boolean().optional(),
  mode: z.enum(["loop", "chat"]).optional(),
});

/**
 * Schema for UpdateLoopRequest - PATCH /api/loops/:id
 *
 * All fields are optional. Extends UpdateLoopRequest interface with
 * additional fields that the PATCH endpoint supports.
 */
export const UpdateLoopRequestSchema = z.object({
  name: LoopNameSchema.optional(),
  directory: z.string().optional(),
  prompt: z.string().optional(),
  model: ModelConfigSchema.optional(),
  maxIterations: z.number().optional(),
  maxConsecutiveErrors: z.number().optional(),
  activityTimeoutSeconds: z
    .number()
    .min(60, "activityTimeoutSeconds must be at least 60 seconds")
    .optional(),
  stopPattern: z.string().optional(),
  git: GitConfigSchema.optional(),
  baseBranch: z.string().optional(),
  useWorktree: z.boolean().optional(),
  clearPlanningFolder: z.boolean().optional(),
  planMode: z.boolean().optional(),
});

/**
 * Schema for explicit AI title generation - POST /api/loops/title
 */
export const GenerateLoopTitleRequestSchema = z.object({
  workspaceId: z.string().min(1, "workspaceId is required"),
  prompt: z.string().trim().min(1, "prompt is required and must be a non-empty string"),
});

/**
 * Schema for AddressCommentsRequest - POST /api/loops/:id/address-comments
 */
export const AddressCommentsRequestSchema = z.object({
  comments: z.string().refine((val) => val.trim().length > 0, {
    message: "comments cannot be empty",
  }),
});

/**
 * Schema for plan feedback - POST /api/loops/:id/plan/feedback
 */
export const PlanFeedbackRequestSchema = z.object({
  feedback: z.string().refine((val) => val.trim().length > 0, {
    message: "feedback cannot be empty",
  }),
});

/**
 * Schema for plan acceptance - POST /api/loops/:id/plan/accept
 */
export const PlanAcceptRequestSchema = z.object({
  mode: z.enum(["start_loop", "open_ssh"]).optional(),
});

/**
 * Schema for pending prompt - PUT /api/loops/:id/pending-prompt
 */
export const PendingPromptRequestSchema = z.object({
  prompt: z.string().refine((val) => val.trim().length > 0, {
    message: "prompt is required and cannot be empty or whitespace-only",
  }),
});

/**
 * Schema for set pending - POST /api/loops/:id/pending
 * At least one of message or model should be provided, but we allow the
 * endpoint to handle that logic. Schema just validates structure.
 */
export const SetPendingRequestSchema = z.object({
  message: z.string().optional(),
  model: ModelConfigSchema.optional(),
  immediate: z.boolean().optional(),
});

/**
 * Schema for starting a draft - POST /api/loops/:id/draft/start
 */
export const StartDraftRequestSchema = z.object({
  planMode: z.boolean({ error: "planMode is required" }),
});

/**
 * Schema for creating a new chat - POST /api/loops/chat
 *
 * Simpler than CreateLoopRequestSchema — chats don't have plan mode,
 * draft mode, stop patterns, or clearPlanningFolder.
 */
export const CreateChatRequestSchema = z.object({
  workspaceId: z.string().min(1, "workspaceId is required"),
  prompt: z.string().min(1, "prompt is required and must be a non-empty string"),
  model: ModelConfigSchema,
  baseBranch: z.string().optional(),
  useWorktree: z.boolean({ error: "useWorktree is required and must be a boolean (true or false)" }),
  git: GitConfigSchema.optional(),
});

/**
 * Schema for sending a chat message - POST /api/loops/:id/chat
 */
export const SendChatMessageRequestSchema = z.object({
  message: z.string().refine((val) => val.trim().length > 0, {
    message: "message cannot be empty",
  }),
  model: ModelConfigSchema.optional(),
});
