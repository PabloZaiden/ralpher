/**
 * Tests for the WorkspaceSelector component.
 */

import { test, expect, describe } from "bun:test";
import { mock } from "bun:test";
import { WorkspaceSelector } from "@/components/WorkspaceSelector";
import { renderWithUser } from "../helpers/render";
import { createWorkspace } from "../helpers/factories";

describe("WorkspaceSelector", () => {
  describe("rendering", () => {
    test("renders workspace label with required asterisk", () => {
      const { getByText } = renderWithUser(
        <WorkspaceSelector workspaces={[]} onSelect={mock()} />
      );
      expect(getByText("Workspace")).toBeInTheDocument();
      expect(getByText("*")).toBeInTheDocument();
    });

    test("renders select element", () => {
      const { getByRole } = renderWithUser(
        <WorkspaceSelector workspaces={[]} onSelect={mock()} />
      );
      expect(getByRole("combobox")).toBeInTheDocument();
    });

    test("renders default placeholder option", () => {
      const workspaces = [createWorkspace({ name: "My Project" })];
      const { getByRole } = renderWithUser(
        <WorkspaceSelector workspaces={workspaces} onSelect={mock()} />
      );
      const select = getByRole("combobox") as HTMLSelectElement;
      expect(select.options[0]?.text).toBe("Select a workspace...");
    });
  });

  describe("workspace options", () => {
    test("renders workspace options with name only", () => {
      const workspaces = [
        createWorkspace({ name: "Project A" }),
        createWorkspace({ name: "Project B" }),
      ];
      const { getByText } = renderWithUser(
        <WorkspaceSelector workspaces={workspaces} onSelect={mock()} />
      );
      expect(getByText("Project A")).toBeInTheDocument();
      expect(getByText("Project B")).toBeInTheDocument();
    });

    test("shows directory when workspace is selected", () => {
      const workspace = createWorkspace({
        id: "ws-1",
        name: "My Workspace",
        directory: "/home/user/project",
      });
      const { getByText } = renderWithUser(
        <WorkspaceSelector
          workspaces={[workspace]}
          selectedWorkspaceId="ws-1"
          onSelect={mock()}
        />
      );
      expect(getByText("/home/user/project")).toBeInTheDocument();
    });

    test("does not show directory when no workspace selected", () => {
      const workspace = createWorkspace({
        directory: "/home/user/project",
      });
      const { queryByText } = renderWithUser(
        <WorkspaceSelector workspaces={[workspace]} onSelect={mock()} />
      );
      expect(queryByText("/home/user/project")).not.toBeInTheDocument();
    });
  });

  describe("loading state", () => {
    test("shows loading text when loading", () => {
      const { getByRole } = renderWithUser(
        <WorkspaceSelector workspaces={[]} loading={true} onSelect={mock()} />
      );
      const select = getByRole("combobox") as HTMLSelectElement;
      expect(select.options[0]?.text).toBe("Loading workspaces...");
    });

    test("disables select when loading", () => {
      const { getByRole } = renderWithUser(
        <WorkspaceSelector workspaces={[]} loading={true} onSelect={mock()} />
      );
      expect(getByRole("combobox")).toBeDisabled();
    });
  });

  describe("empty state", () => {
    test("shows no workspaces text when empty and not loading", () => {
      const { getByRole } = renderWithUser(
        <WorkspaceSelector workspaces={[]} onSelect={mock()} />
      );
      const select = getByRole("combobox") as HTMLSelectElement;
      expect(select.options[0]?.text).toBe("No workspaces available");
    });

    test("disables select when no workspaces", () => {
      const { getByRole } = renderWithUser(
        <WorkspaceSelector workspaces={[]} onSelect={mock()} />
      );
      expect(getByRole("combobox")).toBeDisabled();
    });

    test("shows create workspace hint when no workspaces", () => {
      const { getByText } = renderWithUser(
        <WorkspaceSelector workspaces={[]} onSelect={mock()} />
      );
      expect(getByText("Create a workspace from the dashboard first.")).toBeInTheDocument();
    });
  });

  describe("error state", () => {
    test("renders error message when error provided", () => {
      const { getByText } = renderWithUser(
        <WorkspaceSelector
          workspaces={[]}
          onSelect={mock()}
          error="Failed to load workspaces"
        />
      );
      expect(getByText("Failed to load workspaces")).toBeInTheDocument();
    });

    test("does not render error when no error", () => {
      const { queryByText } = renderWithUser(
        <WorkspaceSelector workspaces={[]} onSelect={mock()} />
      );
      // No red error text should exist
      expect(queryByText("Failed to load")).not.toBeInTheDocument();
    });

    test("does not render error when error is null", () => {
      const { container } = renderWithUser(
        <WorkspaceSelector workspaces={[]} onSelect={mock()} error={null} />
      );
      const errorEl = container.querySelector(".text-red-600");
      expect(errorEl).not.toBeInTheDocument();
    });
  });

  describe("selection interaction", () => {
    test("calls onSelect with workspace id and directory on selection", async () => {
      const onSelect = mock();
      const workspace = createWorkspace({
        id: "ws-1",
        name: "Project A",
        directory: "/home/user/project-a",
      });
      const { getByRole, user } = renderWithUser(
        <WorkspaceSelector workspaces={[workspace]} onSelect={onSelect} />
      );
      const select = getByRole("combobox") as HTMLSelectElement;
      await user.selectOptions(select, "ws-1");
      expect(onSelect).toHaveBeenCalledWith("ws-1", "/home/user/project-a");
    });

    test("calls onSelect with null when deselecting", async () => {
      const onSelect = mock();
      const workspace = createWorkspace({
        id: "ws-1",
        name: "Project A",
      });
      const { getByRole, user } = renderWithUser(
        <WorkspaceSelector
          workspaces={[workspace]}
          selectedWorkspaceId="ws-1"
          onSelect={onSelect}
        />
      );
      const select = getByRole("combobox") as HTMLSelectElement;
      await user.selectOptions(select, "");
      expect(onSelect).toHaveBeenCalledWith(null, "");
    });
  });
});
