/**
 * Tests for the CreateLoopForm component.
 *
 * CreateLoopForm is a complex form for creating new Ralph Loops,
 * including workspace/model/branch selection, plan mode toggle,
 * advanced options, and draft saving.
 */

import { test, expect, describe, mock } from "bun:test";
import { CreateLoopForm } from "@/components/CreateLoopForm";
import { renderWithUser, waitFor } from "../helpers/render";
import {
  createModelInfo,
  createBranchInfo,
  createWorkspaceWithLoopCount,
} from "../helpers/factories";
import type { ModelInfo, CreateLoopRequest } from "@/types";
import type { WorkspaceWithLoopCount } from "@/types/workspace";
import { DEFAULT_LOOP_CONFIG } from "@/types/loop";

/**
 * Helper to set a textarea/input value for form testing.
 * user.type() causes OOM on complex forms even with short strings (4+ chars) due to
 * cascading useEffect re-renders on each keystroke. This helper types a single
 * character with user.type() to properly trigger React's onChange, which is enough
 * to make the form valid for testing submission flows.
 */
async function setInputValue(
  user: ReturnType<typeof import("@testing-library/user-event")["default"]["setup"]>,
  element: HTMLTextAreaElement | HTMLInputElement,
  _value: string,
) {
  // Type a single char - this is enough to make the prompt non-empty and
  // trigger React's controlled component update. The actual content doesn't
  // matter for form validation tests.
  await user.type(element, "X");
}

// Default props factory
function defaultProps(overrides?: Partial<Parameters<typeof CreateLoopForm>[0]>) {
  return {
    onSubmit: mock(async (_req: CreateLoopRequest) => true),
    onCancel: mock(() => {}),
    ...overrides,
  };
}

// Common test data
function connectedModels(): ModelInfo[] {
  return [
    createModelInfo({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-20250514",
      modelName: "Claude Sonnet 4",
      providerName: "Anthropic",
      connected: true,
    }),
    createModelInfo({
      providerID: "openai",
      modelID: "gpt-4o",
      modelName: "GPT-4o",
      providerName: "OpenAI",
      connected: true,
    }),
  ];
}

function testWorkspaces(): WorkspaceWithLoopCount[] {
  return [
    createWorkspaceWithLoopCount({
      id: "ws-1",
      name: "Project A",
      directory: "/workspaces/project-a",
      loopCount: 2,
    }),
    createWorkspaceWithLoopCount({
      id: "ws-2",
      name: "Project B",
      directory: "/workspaces/project-b",
      loopCount: 0,
    }),
  ];
}

describe("CreateLoopForm", () => {
  describe("basic rendering", () => {
    test("renders workspace selector", () => {
      const { getByText } = renderWithUser(
        <CreateLoopForm {...defaultProps({ workspaces: testWorkspaces() })} />
      );
      expect(getByText("Workspace")).toBeInTheDocument();
    });

    test("renders base branch selector", () => {
      const { getByLabelText } = renderWithUser(
        <CreateLoopForm {...defaultProps()} />
      );
      expect(getByLabelText("Base Branch")).toBeInTheDocument();
    });

    test("renders model selector", () => {
      const { getByLabelText } = renderWithUser(
        <CreateLoopForm {...defaultProps()} />
      );
      expect(getByLabelText("Model")).toBeInTheDocument();
    });

    test("renders prompt textarea", () => {
      const { getByLabelText } = renderWithUser(
        <CreateLoopForm {...defaultProps()} />
      );
      expect(getByLabelText(/Prompt/)).toBeInTheDocument();
    });

    test("renders plan mode checkbox checked by default", () => {
      const { getByRole } = renderWithUser(
        <CreateLoopForm {...defaultProps()} />
      );
      const checkbox = getByRole("checkbox", { name: /Plan Mode/ }) as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
    });

    test("renders advanced options toggle", () => {
      const { getByText } = renderWithUser(
        <CreateLoopForm {...defaultProps()} />
      );
      expect(getByText("Show advanced options")).toBeInTheDocument();
    });

    test("renders action buttons when renderActions is not provided", () => {
      const { getByRole } = renderWithUser(
        <CreateLoopForm {...defaultProps()} />
      );
      expect(getByRole("button", { name: "Cancel" })).toBeInTheDocument();
      expect(getByRole("button", { name: "Create Plan" })).toBeInTheDocument();
    });

    test("does not render action buttons when renderActions is provided", () => {
      const { queryByRole } = renderWithUser(
        <CreateLoopForm {...defaultProps({ renderActions: mock(() => {}) })} />
      );
      expect(queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
      expect(queryByRole("button", { name: "Create Plan" })).not.toBeInTheDocument();
    });
  });

  describe("model selector", () => {
    test("shows 'Loading models...' when modelsLoading is true", () => {
      const { getByLabelText } = renderWithUser(
        <CreateLoopForm {...defaultProps({ modelsLoading: true })} />
      );
      const select = getByLabelText("Model") as HTMLSelectElement;
      expect(select).toBeDisabled();
      const options = Array.from(select.options).map(o => o.text);
      expect(options).toContain("Loading models...");
    });

    test("shows 'Select a workspace to load models' when no models", () => {
      const { getByLabelText } = renderWithUser(
        <CreateLoopForm {...defaultProps({ models: [] })} />
      );
      const select = getByLabelText("Model") as HTMLSelectElement;
      const options = Array.from(select.options).map(o => o.text);
      expect(options).toContain("Select a workspace to load models");
    });

    test("groups models by provider", () => {
      const { getByLabelText } = renderWithUser(
        <CreateLoopForm {...defaultProps({ models: connectedModels() })} />
      );
      const select = getByLabelText("Model") as HTMLSelectElement;
      const optgroups = select.querySelectorAll("optgroup");
      const labels = Array.from(optgroups).map(g => g.label);
      expect(labels).toContain("Anthropic");
      expect(labels).toContain("OpenAI");
    });

    test("auto-selects first connected model", async () => {
      const { getByLabelText } = renderWithUser(
        <CreateLoopForm {...defaultProps({ models: connectedModels() })} />
      );
      const select = getByLabelText("Model") as HTMLSelectElement;
      // Should auto-select first connected model (Anthropic - sorted alphabetically)
      await waitFor(() => {
        expect(select.value).toBe("anthropic:claude-sonnet-4-20250514:");
      });
    });

    test("auto-selects lastModel when provided", async () => {
      const models = connectedModels();
      const lastModel = { providerID: "openai", modelID: "gpt-4o" };

      const { getByLabelText } = renderWithUser(
        <CreateLoopForm {...defaultProps({ models, lastModel })} />
      );
      const select = getByLabelText("Model") as HTMLSelectElement;
      await waitFor(() => {
        expect(select.value).toBe("openai:gpt-4o:");
      });
    });

    test("shows error when no providers are connected", () => {
      const models = [
        createModelInfo({ connected: false, providerName: "Anthropic" }),
      ];
      const { getByText } = renderWithUser(
        <CreateLoopForm {...defaultProps({ models })} />
      );
      expect(getByText(/No providers are connected/)).toBeInTheDocument();
    });

    test("shows required model error when models available but none selected", async () => {
      // Render with models but no lastModel - component will auto-select first connected
      // We need to prevent auto-selection, so render with models that are all disconnected 
      // but at least one provider exists
      const models = connectedModels();
      // Use a fresh render where we manually clear the selection after auto-select
      const { getByLabelText, getByText } = renderWithUser(
        <CreateLoopForm {...defaultProps({ models })} />
      );
      
      const select = getByLabelText("Model") as HTMLSelectElement;
      
      // Wait for auto-selection, then clear it using DOM manipulation
      await waitFor(() => {
        expect(select.value).not.toBe("");
      });
      
      // Use direct DOM manipulation to clear the selection (same pattern as LoopActionBar tests)
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      setter?.call(select, "");
      select.dispatchEvent(new Event("change", { bubbles: true }));
      
      await waitFor(() => {
        expect(getByText("Model is required. Please select a model.")).toBeInTheDocument();
      });
    });

    test("renders model variants as separate options", () => {
      const models = [
        createModelInfo({
          providerID: "anthropic",
          modelID: "claude-sonnet",
          modelName: "Claude Sonnet",
          providerName: "Anthropic",
          connected: true,
          variants: ["fast", "standard"],
        }),
      ];

      const { getByLabelText } = renderWithUser(
        <CreateLoopForm {...defaultProps({ models })} />
      );
      const select = getByLabelText("Model") as HTMLSelectElement;
      const optionTexts = Array.from(select.options).map(o => o.text);
      expect(optionTexts).toContain("Claude Sonnet (fast)");
      expect(optionTexts).toContain("Claude Sonnet (standard)");
    });
  });

  describe("branch selector", () => {
    test("shows 'Select a workspace to load branches' when no branches", () => {
      const { getByLabelText } = renderWithUser(
        <CreateLoopForm {...defaultProps({ branches: [] })} />
      );
      const select = getByLabelText("Base Branch") as HTMLSelectElement;
      const options = Array.from(select.options).map(o => o.text);
      expect(options).toContain("Select a workspace to load branches");
    });

    test("shows 'Loading branches...' when branchesLoading", () => {
      const { getByLabelText } = renderWithUser(
        <CreateLoopForm {...defaultProps({ branchesLoading: true })} />
      );
      const select = getByLabelText("Base Branch") as HTMLSelectElement;
      expect(select).toBeDisabled();
    });

    test("shows default branch with label", () => {
      const branches = [
        createBranchInfo({ name: "main", current: true }),
        createBranchInfo({ name: "feature-a", current: false }),
      ];
      const { getByLabelText } = renderWithUser(
        <CreateLoopForm
          {...defaultProps({
            branches,
            defaultBranch: "main",
            currentBranch: "main",
          })}
        />
      );
      const select = getByLabelText("Base Branch") as HTMLSelectElement;
      const options = Array.from(select.options).map(o => o.text);
      expect(options).toContain("main (default) (current)");
    });

    test("shows current branch separately if different from default", () => {
      const branches = [
        createBranchInfo({ name: "main", current: false }),
        createBranchInfo({ name: "develop", current: true }),
      ];
      const { getByLabelText } = renderWithUser(
        <CreateLoopForm
          {...defaultProps({
            branches,
            defaultBranch: "main",
            currentBranch: "develop",
          })}
        />
      );
      const select = getByLabelText("Base Branch") as HTMLSelectElement;
      const options = Array.from(select.options).map(o => o.text);
      expect(options).toContain("main (default)");
      expect(options).toContain("develop (current)");
    });
  });

  describe("prompt", () => {
    test("prompt is required", () => {
      const { getByLabelText } = renderWithUser(
        <CreateLoopForm {...defaultProps()} />
      );
      const textarea = getByLabelText(/Prompt/) as HTMLTextAreaElement;
      expect(textarea.required).toBe(true);
    });

    test("shows plan mode placeholder when plan mode is on", () => {
      const { getByPlaceholderText } = renderWithUser(
        <CreateLoopForm {...defaultProps()} />
      );
      expect(
        getByPlaceholderText(/Describe what you want to achieve/)
      ).toBeInTheDocument();
    });

    test("shows execution placeholder when plan mode is off", async () => {
      const { getByRole, getByPlaceholderText, user } = renderWithUser(
        <CreateLoopForm {...defaultProps()} />
      );
      // Toggle plan mode off
      await user.click(getByRole("checkbox", { name: /Plan Mode/ }));
      expect(
        getByPlaceholderText(/Do everything that's pending/)
      ).toBeInTheDocument();
    });
  });

  describe("plan mode toggle", () => {
    test("plan mode is enabled by default", () => {
      const { getByRole } = renderWithUser(
        <CreateLoopForm {...defaultProps()} />
      );
      expect((getByRole("checkbox", { name: /Plan Mode/ }) as HTMLInputElement).checked).toBe(true);
    });

    test("toggling plan mode changes submit button text", async () => {
      const { getByRole, user } = renderWithUser(
        <CreateLoopForm
          {...defaultProps({
            models: connectedModels(),
            workspaces: testWorkspaces(),
          })}
        />
      );

      // Default is "Create Plan"
      expect(getByRole("button", { name: "Create Plan" })).toBeInTheDocument();

      // Toggle off
      await user.click(getByRole("checkbox", { name: /Plan Mode/ }));
      expect(getByRole("button", { name: "Create Loop" })).toBeInTheDocument();
    });

  });

  describe("advanced options", () => {
    test("advanced options are hidden by default", () => {
      const { queryByLabelText } = renderWithUser(
        <CreateLoopForm {...defaultProps()} />
      );
      expect(queryByLabelText("Max Iterations")).not.toBeInTheDocument();
    });

    test("shows advanced options when toggle is clicked", async () => {
      const { getByText, getByLabelText, user } = renderWithUser(
        <CreateLoopForm {...defaultProps()} />
      );
      await user.click(getByText("Show advanced options"));
      expect(getByLabelText("Max Iterations")).toBeInTheDocument();
      expect(getByLabelText("Max Consecutive Errors")).toBeInTheDocument();
      expect(getByLabelText("Activity Timeout (seconds)")).toBeInTheDocument();
    });

    test("toggle button text changes when expanded", async () => {
      const { getByText, user } = renderWithUser(
        <CreateLoopForm {...defaultProps()} />
      );
      await user.click(getByText("Show advanced options"));
      expect(getByText("Hide advanced options")).toBeInTheDocument();
    });

    test("shows clear planning folder checkbox in advanced options", async () => {
      const { getByText, getByLabelText, user } = renderWithUser(
        <CreateLoopForm {...defaultProps()} />
      );
      await user.click(getByText("Show advanced options"));
      expect(getByLabelText(/Clear .\/\.planning folder/)).toBeInTheDocument();
    });

    test("max consecutive errors defaults to 10", async () => {
      const { getByText, getByLabelText, user } = renderWithUser(
        <CreateLoopForm {...defaultProps()} />
      );
      await user.click(getByText("Show advanced options"));
      expect((getByLabelText("Max Consecutive Errors") as HTMLInputElement).value).toBe("10");
    });

    test(`activity timeout defaults to ${DEFAULT_LOOP_CONFIG.activityTimeoutSeconds}`, async () => {
      const { getByText, getByLabelText, user } = renderWithUser(
        <CreateLoopForm {...defaultProps()} />
      );
      await user.click(getByText("Show advanced options"));
      expect((getByLabelText("Activity Timeout (seconds)") as HTMLInputElement).value).toBe(String(DEFAULT_LOOP_CONFIG.activityTimeoutSeconds));
    });
  });

  describe("planning warning", () => {
    test("shows planning warning when provided", () => {
      const { getByText } = renderWithUser(
        <CreateLoopForm
          {...defaultProps({
            planningWarning: "A .planning folder already exists",
          })}
        />
      );
      expect(getByText("A .planning folder already exists")).toBeInTheDocument();
    });

    test("does not show warning when null", () => {
      const { queryByText } = renderWithUser(
        <CreateLoopForm {...defaultProps({ planningWarning: null })} />
      );
      expect(queryByText(/\.planning folder/)).not.toBeInTheDocument();
    });
  });

  describe("form submission", () => {
    test("submit button is disabled when workspace is not selected", () => {
      const { getByRole } = renderWithUser(
        <CreateLoopForm
          {...defaultProps({
            models: connectedModels(),
          })}
        />
      );
      expect(getByRole("button", { name: "Create Plan" })).toBeDisabled();
    });

    test("submit button is disabled when model is not selected", async () => {
      const { getByRole, getByLabelText, user } = renderWithUser(
        <CreateLoopForm
          {...defaultProps({
            workspaces: testWorkspaces(),
            models: connectedModels(),
          })}
        />
      );

      // Select workspace
      const workspaceSelect = getByLabelText("Workspace *") as HTMLSelectElement;
      await user.selectOptions(workspaceSelect, "ws-1");

      // Set prompt value
      await setInputValue(user, getByLabelText(/Prompt/) as HTMLTextAreaElement, "Test");

      // Wait for model auto-selection, then clear it using DOM manipulation
      // (user.selectOptions(select, "") causes OOM on this complex form)
      const modelSelect = getByLabelText("Model") as HTMLSelectElement;
      await waitFor(() => {
        expect(modelSelect.value).not.toBe("");
      });
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      setter?.call(modelSelect, "");
      modelSelect.dispatchEvent(new Event("change", { bubbles: true }));

      await waitFor(() => {
        expect(getByRole("button", { name: "Create Plan" })).toBeDisabled();
      });
    });

    test("calls onSubmit with correct request and onCancel on success", async () => {
      const onSubmit = mock(async (_req: CreateLoopRequest) => true);
      const onCancel = mock(() => {});

      const { getByLabelText, getByRole, user } = renderWithUser(
        <CreateLoopForm
          {...defaultProps({
            onSubmit,
            onCancel,
            workspaces: testWorkspaces(),
            models: connectedModels(),
            branches: [createBranchInfo({ name: "main" })],
            defaultBranch: "main",
            currentBranch: "main",
          })}
        />
      );

      // Select workspace
      const workspaceSelect = getByLabelText("Workspace *") as HTMLSelectElement;
      await user.selectOptions(workspaceSelect, "ws-1");

      // Set prompt value (using setInputValue to avoid OOM from user.type on complex forms)
      await setInputValue(user, getByLabelText(/Prompt/) as HTMLTextAreaElement, "Do it");

      // Wait for model auto-selection
      await waitFor(() => {
        expect((getByLabelText("Model") as HTMLSelectElement).value).not.toBe("");
      });

      // Submit
      await user.click(getByRole("button", { name: "Create Plan" }));

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });

      const req = onSubmit.mock.calls[0]?.[0] as CreateLoopRequest;
      expect(req.workspaceId).toBe("ws-1");
      expect(req.prompt).toBe("X");
      expect(req.planMode).toBe(true);
      expect(req.model).toBeDefined();
      expect(req.model.providerID).toBe("anthropic");

      // onCancel should be called on success (closes the modal)
      await waitFor(() => {
        expect(onCancel).toHaveBeenCalledTimes(1);
      });
    });

    test("does not call onCancel when submission fails", async () => {
      const onSubmit = mock(async (_req: CreateLoopRequest) => false);
      const onCancel = mock(() => {});

      const { getByLabelText, getByRole, user } = renderWithUser(
        <CreateLoopForm
          {...defaultProps({
            onSubmit,
            onCancel,
            workspaces: testWorkspaces(),
            models: connectedModels(),
          })}
        />
      );

      // Select workspace
      const workspaceSelect = getByLabelText("Workspace *") as HTMLSelectElement;
      await user.selectOptions(workspaceSelect, "ws-1");

      // Set prompt value (using setInputValue to avoid OOM from user.type on complex forms)
      await setInputValue(user, getByLabelText(/Prompt/) as HTMLTextAreaElement, "Test");

      // Wait for model auto-selection
      await waitFor(() => {
        expect((getByLabelText("Model") as HTMLSelectElement).value).not.toBe("");
      });

      // Submit
      await user.click(getByRole("button", { name: "Create Plan" }));

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });

      // onCancel should NOT be called when submission fails
      expect(onCancel).not.toHaveBeenCalled();
    });
  });

  describe("save as draft", () => {
    test("renders Save as Draft button", () => {
      const { getByRole } = renderWithUser(
        <CreateLoopForm {...defaultProps()} />
      );
      expect(getByRole("button", { name: "Save as Draft" })).toBeInTheDocument();
    });

    test("Save as Draft is disabled when workspace is not selected", () => {
      const { getByRole } = renderWithUser(
        <CreateLoopForm {...defaultProps()} />
      );
      expect(getByRole("button", { name: "Save as Draft" })).toBeDisabled();
    });

    test("calls onSubmit with draft=true", async () => {
      const onSubmit = mock(async (_req: CreateLoopRequest) => true);

      const { getByLabelText, getByRole, user } = renderWithUser(
        <CreateLoopForm
          {...defaultProps({
            onSubmit,
            workspaces: testWorkspaces(),
            models: connectedModels(),
          })}
        />
      );

      // Fill required fields
      const workspaceSelect = getByLabelText("Workspace *") as HTMLSelectElement;
      await user.selectOptions(workspaceSelect, "ws-1");
      // Set prompt value (using setInputValue to avoid OOM from user.type on complex forms)
      await setInputValue(user, getByLabelText(/Prompt/) as HTMLTextAreaElement, "Draft");

      // Wait for model auto-selection
      await waitFor(() => {
        expect((getByLabelText("Model") as HTMLSelectElement).value).not.toBe("");
      });

      // Click Save as Draft
      await user.click(getByRole("button", { name: "Save as Draft" }));

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });

      const req = onSubmit.mock.calls[0]?.[0] as CreateLoopRequest;
      expect(req.draft).toBe(true);
    });
  });

  describe("edit mode", () => {
    test("pre-populates form fields from initialLoopData", () => {
      const { getByLabelText, getByRole } = renderWithUser(
        <CreateLoopForm
          {...defaultProps({
            editLoopId: "loop-1",
            initialLoopData: {
              directory: "/workspaces/project-a",
              prompt: "Existing prompt text",
              model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
              planMode: false,
              workspaceId: "ws-1",
            },
            workspaces: testWorkspaces(),
            models: connectedModels(),
          })}
        />
      );

      const promptTextarea = getByLabelText(/Prompt/) as HTMLTextAreaElement;
      expect(promptTextarea.value).toBe("Existing prompt text");

      const planMode = getByRole("checkbox", { name: /Plan Mode/ }) as HTMLInputElement;
      expect(planMode.checked).toBe(false);
    });

    test("shows 'Start Loop' button in edit mode without plan mode", () => {
      const { getByRole } = renderWithUser(
        <CreateLoopForm
          {...defaultProps({
            editLoopId: "loop-1",
            initialLoopData: {
              directory: "/workspaces/project-a",
              prompt: "Test",
              planMode: false,
              workspaceId: "ws-1",
            },
            workspaces: testWorkspaces(),
            models: connectedModels(),
          })}
        />
      );
      expect(getByRole("button", { name: "Start Loop" })).toBeInTheDocument();
    });

    test("shows 'Start Plan' button in edit mode with plan mode", () => {
      const { getByRole } = renderWithUser(
        <CreateLoopForm
          {...defaultProps({
            editLoopId: "loop-1",
            initialLoopData: {
              directory: "/workspaces/project-a",
              prompt: "Test",
              planMode: true,
              workspaceId: "ws-1",
            },
            workspaces: testWorkspaces(),
            models: connectedModels(),
          })}
        />
      );
      expect(getByRole("button", { name: "Start Plan" })).toBeInTheDocument();
    });

    test("shows 'Update Draft' button when editing a draft", () => {
      const { getByRole } = renderWithUser(
        <CreateLoopForm
          {...defaultProps({
            editLoopId: "loop-1",
            isEditingDraft: true,
            initialLoopData: {
              directory: "/workspaces/project-a",
              prompt: "Test",
              workspaceId: "ws-1",
            },
            workspaces: testWorkspaces(),
            models: connectedModels(),
          })}
        />
      );
      expect(getByRole("button", { name: "Update Draft" })).toBeInTheDocument();
    });

    test("pre-populates advanced options from initialLoopData", async () => {
      const { getByLabelText, getByText, user } = renderWithUser(
        <CreateLoopForm
          {...defaultProps({
            editLoopId: "loop-1",
            initialLoopData: {
              directory: "/workspaces/project-a",
              prompt: "Test",
              maxIterations: 5,
              maxConsecutiveErrors: 3,
              activityTimeoutSeconds: 300,
              clearPlanningFolder: true,
              workspaceId: "ws-1",
            },
            workspaces: testWorkspaces(),
            models: connectedModels(),
          })}
        />
      );

      // Show advanced options
      await user.click(getByText("Show advanced options"));

      expect((getByLabelText("Max Iterations") as HTMLInputElement).value).toBe("5");
      expect((getByLabelText("Max Consecutive Errors") as HTMLInputElement).value).toBe("3");
      expect((getByLabelText("Activity Timeout (seconds)") as HTMLInputElement).value).toBe("300");
      expect((getByLabelText(/Clear .\/\.planning folder/) as HTMLInputElement).checked).toBe(true);
    });
  });

  describe("cancel", () => {
    test("calls onCancel when Cancel button is clicked", async () => {
      const onCancel = mock(() => {});
      const { getByRole, user } = renderWithUser(
        <CreateLoopForm {...defaultProps({ onCancel })} />
      );
      await user.click(getByRole("button", { name: "Cancel" }));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });

  describe("workspace change notification", () => {
    test("calls onWorkspaceChange when workspace is selected", async () => {
      const onWorkspaceChange = mock((_workspaceId: string | null, _directory: string) => {});
      const { getByLabelText, user } = renderWithUser(
        <CreateLoopForm
          {...defaultProps({
            workspaces: testWorkspaces(),
            onWorkspaceChange,
          })}
        />
      );

      const select = getByLabelText("Workspace *") as HTMLSelectElement;
      await user.selectOptions(select, "ws-1");

      await waitFor(() => {
        expect(onWorkspaceChange).toHaveBeenCalled();
        // Last call should have the selected workspace id and directory
        const lastCall = onWorkspaceChange.mock.calls[onWorkspaceChange.mock.calls.length - 1];
        expect(lastCall?.[0]).toBe("ws-1");
      });
    });
  });

  describe("loading state", () => {
    test("disables submit button when loading", () => {
      const { getByRole } = renderWithUser(
        <CreateLoopForm {...defaultProps({ loading: true })} />
      );
      expect(getByRole("button", { name: "Create Plan" })).toBeDisabled();
    });
  });
});
