/**
 * API endpoints for persistent SSH sessions.
 */

import { createLogger } from "../core/logger";
import { sshSessionManager } from "../core/ssh-session-manager";
import { errorResponse } from "./helpers";
import { parseAndValidate } from "./validation";
import { CreateSshSessionRequestSchema, UpdateSshSessionRequestSchema } from "../types/schemas";

const log = createLogger("api:ssh-sessions");

function mapSessionError(error: unknown): Response {
  const message = String(error);
  if (message.includes("not found")) {
    return errorResponse("not_found", message, 404);
  }
  if (message.includes("ssh transport") || message.includes("tmux")) {
    return errorResponse("invalid_session_configuration", message, 400);
  }
  return errorResponse("ssh_session_error", message, 500);
}

export const sshSessionsRoutes = {
  "/api/ssh-sessions": {
    async GET(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const workspaceId = url.searchParams.get("workspaceId") ?? undefined;
      try {
        const sessions = await sshSessionManager.listSessions(workspaceId);
        return Response.json(sessions);
      } catch (error) {
        log.error("Failed to list SSH sessions", { error: String(error), workspaceId });
        return mapSessionError(error);
      }
    },

    async POST(req: Request): Promise<Response> {
      const validation = await parseAndValidate(CreateSshSessionRequestSchema, req);
      if (!validation.success) {
        return validation.response;
      }

      try {
        const session = await sshSessionManager.createSession(validation.data);
        return Response.json(session, { status: 201 });
      } catch (error) {
        log.error("Failed to create SSH session", { error: String(error) });
        return mapSessionError(error);
      }
    },
  },

  "/api/ssh-sessions/:id": {
    async GET(req: Request & { params: { id: string } }): Promise<Response> {
      try {
        const session = await sshSessionManager.getSession(req.params.id);
        if (!session) {
          return errorResponse("not_found", "SSH session not found", 404);
        }
        return Response.json(session);
      } catch (error) {
        log.error("Failed to fetch SSH session", { error: String(error), id: req.params.id });
        return mapSessionError(error);
      }
    },

    async PATCH(req: Request & { params: { id: string } }): Promise<Response> {
      const validation = await parseAndValidate(UpdateSshSessionRequestSchema, req);
      if (!validation.success) {
        return validation.response;
      }

      try {
        const session = await sshSessionManager.updateSession(req.params.id, validation.data);
        return Response.json(session);
      } catch (error) {
        log.error("Failed to update SSH session", { error: String(error), id: req.params.id });
        return mapSessionError(error);
      }
    },

    async DELETE(req: Request & { params: { id: string } }): Promise<Response> {
      try {
        const deleted = await sshSessionManager.deleteSession(req.params.id);
        if (!deleted) {
          return errorResponse("not_found", "SSH session not found", 404);
        }
        return Response.json({ success: true });
      } catch (error) {
        log.error("Failed to delete SSH session", { error: String(error), id: req.params.id });
        return mapSessionError(error);
      }
    },
  },
};

