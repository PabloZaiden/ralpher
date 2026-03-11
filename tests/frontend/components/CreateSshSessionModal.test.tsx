import { describe, expect, test } from "bun:test";
import type { CreateSshSessionRequest } from "@/types";
import { CreateSshSessionModal } from "@/components/CreateSshSessionModal";
import { createSshSession, createWorkspace } from "../helpers/factories";
import { renderWithUser, waitFor } from "../helpers/render";

describe("CreateSshSessionModal", () => {
  test("shows a workspace-scoped default name and lets the backend generate it when unchanged", async () => {
    const workspace = createWorkspace({
      id: "ws-1",
      name: "My project",
      serverSettings: {
        agent: {
          provider: "opencode",
          transport: "ssh",
          hostname: "localhost",
        },
      },
    });
    const otherWorkspace = createWorkspace({
      id: "ws-2",
      name: "Other project",
      directory: "/workspaces/other-project",
      serverSettings: {
        agent: {
          provider: "opencode",
          transport: "ssh",
          hostname: "localhost",
        },
      },
    });
    const sessions = [
      createSshSession({ config: { workspaceId: workspace.id } }),
      createSshSession({ config: { workspaceId: workspace.id } }),
      createSshSession({ config: { workspaceId: otherWorkspace.id } }),
    ];

    let createdRequest: CreateSshSessionRequest | null = null;

    const { getByLabelText, getByRole, user } = renderWithUser(
      <CreateSshSessionModal
        isOpen
        onClose={() => {}}
        onCreate={async (request) => {
          createdRequest = request;
          return createSshSession({
            config: {
              id: "ssh-created-1",
              name: "My project 3",
              workspaceId: request.workspaceId,
            },
          });
        }}
        sessions={sessions}
        workspaces={[workspace, otherWorkspace]}
        workspacesLoading={false}
        workspaceError={null}
        onCreated={() => {}}
      />,
    );

    await waitFor(() => {
      expect((getByLabelText("Session name") as HTMLInputElement).value).toBe("My project 3");
    });

    await user.click(getByRole("button", { name: "Create Session" }));

    await waitFor(() => {
      expect(createdRequest).toEqual({
        workspaceId: workspace.id,
      });
    });
  });
});
