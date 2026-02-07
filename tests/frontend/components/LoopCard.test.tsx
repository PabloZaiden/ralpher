/**
 * Tests for the LoopCard component.
 */

import { test, expect, describe } from "bun:test";
import { mock } from "bun:test";
import { LoopCard } from "@/components/LoopCard";
import { renderWithUser } from "../helpers/render";
import {
  createLoop,
  createLoopWithStatus,
  createGitState,
  createGitCommit,
  createLoopError,
} from "../helpers/factories";

describe("LoopCard", () => {
  describe("basic rendering", () => {
    test("renders loop name", () => {
      const loop = createLoop({ config: { name: "My Test Loop" } });
      const { getByText } = renderWithUser(<LoopCard loop={loop} />);
      expect(getByText("My Test Loop")).toBeInTheDocument();
    });

    test("renders loop directory", () => {
      const loop = createLoop({ config: { directory: "/home/user/project" } });
      const { getByText } = renderWithUser(<LoopCard loop={loop} />);
      expect(getByText("/home/user/project")).toBeInTheDocument();
    });

    test("renders status badge", () => {
      const loop = createLoopWithStatus("running");
      const { getByText } = renderWithUser(<LoopCard loop={loop} />);
      expect(getByText("Running")).toBeInTheDocument();
    });
  });

  describe("status-specific rendering", () => {
    test("idle loop shows Idle badge", () => {
      const loop = createLoopWithStatus("idle");
      const { getByText } = renderWithUser(<LoopCard loop={loop} />);
      expect(getByText("Idle")).toBeInTheDocument();
    });

    test("planning loop shows Planning badge", () => {
      const loop = createLoopWithStatus("planning");
      const { getByText } = renderWithUser(<LoopCard loop={loop} />);
      expect(getByText("Planning")).toBeInTheDocument();
    });

    test("completed loop shows Completed badge", () => {
      const loop = createLoopWithStatus("completed");
      const { getByText } = renderWithUser(<LoopCard loop={loop} />);
      expect(getByText("Completed")).toBeInTheDocument();
    });

    test("failed loop shows Failed badge", () => {
      const loop = createLoopWithStatus("failed");
      const { getByText } = renderWithUser(<LoopCard loop={loop} />);
      expect(getByText("Failed")).toBeInTheDocument();
    });

    test("merged loop shows Merged badge", () => {
      const loop = createLoopWithStatus("merged");
      const { getByText } = renderWithUser(<LoopCard loop={loop} />);
      expect(getByText("Merged")).toBeInTheDocument();
    });

    test("pushed loop shows Pushed badge", () => {
      const loop = createLoopWithStatus("pushed");
      const { getByText } = renderWithUser(<LoopCard loop={loop} />);
      expect(getByText("Pushed")).toBeInTheDocument();
    });

    test("deleted loop shows Deleted badge", () => {
      const loop = createLoopWithStatus("deleted");
      const { getByText } = renderWithUser(<LoopCard loop={loop} />);
      expect(getByText("Deleted")).toBeInTheDocument();
    });
  });

  describe("active indicators", () => {
    test("running loop has blue ring", () => {
      const loop = createLoopWithStatus("running");
      const { container } = renderWithUser(<LoopCard loop={loop} />);
      const card = container.querySelector(".ring-2.ring-blue-500");
      expect(card).toBeInTheDocument();
    });

    test("planning loop has cyan ring", () => {
      const loop = createLoopWithStatus("planning");
      const { container } = renderWithUser(<LoopCard loop={loop} />);
      const card = container.querySelector(".ring-2.ring-cyan-500");
      expect(card).toBeInTheDocument();
    });

    test("completed loop has no ring", () => {
      const loop = createLoopWithStatus("completed");
      const { container } = renderWithUser(<LoopCard loop={loop} />);
      const card = container.querySelector(".ring-2");
      expect(card).not.toBeInTheDocument();
    });
  });

  describe("stats section", () => {
    test("shows iterations for non-draft loops", () => {
      const loop = createLoopWithStatus("running", {
        state: { currentIteration: 5 },
        config: { maxIterations: 10 },
      });
      const { getByText } = renderWithUser(<LoopCard loop={loop} />);
      expect(getByText("Iterations:")).toBeInTheDocument();
      expect(getByText("5/10")).toBeInTheDocument();
    });

    test("shows iterations with Infinity when maxIterations is Infinity", () => {
      const loop = createLoopWithStatus("running", {
        state: { currentIteration: 3 },
        config: { maxIterations: Infinity },
      });
      const { getByText } = renderWithUser(<LoopCard loop={loop} />);
      // Infinity is truthy so it renders as "3/Infinity"
      expect(getByText("3/Infinity")).toBeInTheDocument();
    });

    test("shows last activity text", () => {
      const loop = createLoopWithStatus("running");
      const { getByText } = renderWithUser(<LoopCard loop={loop} />);
      expect(getByText("Last activity:")).toBeInTheDocument();
    });

    test("hides stats for draft loops", () => {
      const loop = createLoopWithStatus("draft" as any);
      const { queryByText } = renderWithUser(<LoopCard loop={loop} />);
      expect(queryByText("Iterations:")).not.toBeInTheDocument();
      expect(queryByText("Last activity:")).not.toBeInTheDocument();
    });
  });

  describe("error display", () => {
    test("shows error message for failed loops", () => {
      const loop = createLoopWithStatus("failed", {
        state: { error: createLoopError({ message: "Out of memory" }) },
      });
      const { getByText } = renderWithUser(<LoopCard loop={loop} />);
      expect(getByText("Out of memory")).toBeInTheDocument();
    });

    test("does not show error section for loops without errors", () => {
      const loop = createLoopWithStatus("completed");
      const { container } = renderWithUser(<LoopCard loop={loop} />);
      const errorBox = container.querySelector(".bg-red-50, .dark\\:bg-red-900\\/20");
      expect(errorBox).not.toBeInTheDocument();
    });
  });

  describe("git info", () => {
    test("shows working branch for non-draft loops with git state", () => {
      const loop = createLoopWithStatus("running", {
        state: {
          git: createGitState({ workingBranch: "ralph/feature-x" }),
        },
      });
      const { getByText } = renderWithUser(<LoopCard loop={loop} />);
      expect(getByText("Branch:")).toBeInTheDocument();
      expect(getByText("ralph/feature-x")).toBeInTheDocument();
    });

    test("shows commit count when commits exist", () => {
      const loop = createLoopWithStatus("completed", {
        state: {
          git: createGitState({
            workingBranch: "ralph/test",
            commits: [createGitCommit(), createGitCommit(), createGitCommit()],
          }),
        },
      });
      const { getByText } = renderWithUser(<LoopCard loop={loop} />);
      expect(getByText("(3 commits)")).toBeInTheDocument();
    });

    test("hides commit count when no commits", () => {
      const loop = createLoopWithStatus("completed", {
        state: {
          git: createGitState({ commits: [] }),
        },
      });
      const { queryByText } = renderWithUser(<LoopCard loop={loop} />);
      expect(queryByText(/commits\)/)).not.toBeInTheDocument();
    });

    test("hides git info for draft loops", () => {
      const loop = createLoopWithStatus("draft" as any, {
        state: {
          git: createGitState({ workingBranch: "ralph/draft-branch" }),
        },
      });
      const { queryByText } = renderWithUser(<LoopCard loop={loop} />);
      expect(queryByText("Branch:")).not.toBeInTheDocument();
    });
  });

  describe("review mode", () => {
    test("shows Addressable badge when loop is addressable", () => {
      const loop = createLoopWithStatus("pushed", {
        state: {
          reviewMode: {
            addressable: true,
            completionAction: "push",
            reviewCycles: 1,
            reviewBranches: [],
          },
        },
      });
      const { getByText } = renderWithUser(<LoopCard loop={loop} />);
      expect(getByText("Addressable")).toBeInTheDocument();
    });

    test("does not show Addressable badge when not addressable", () => {
      const loop = createLoopWithStatus("completed");
      const { queryByText } = renderWithUser(<LoopCard loop={loop} />);
      expect(queryByText("Addressable")).not.toBeInTheDocument();
    });

    test("shows review cycle number when > 0", () => {
      const loop = createLoopWithStatus("pushed", {
        state: {
          reviewMode: {
            addressable: true,
            completionAction: "push",
            reviewCycles: 3,
            reviewBranches: [],
          },
        },
      });
      const { getByText } = renderWithUser(<LoopCard loop={loop} />);
      expect(getByText("Review Cycle: 3")).toBeInTheDocument();
    });

    test("does not show review cycle when cycles is 0", () => {
      const loop = createLoopWithStatus("pushed", {
        state: {
          reviewMode: {
            addressable: true,
            completionAction: "push",
            reviewCycles: 0,
            reviewBranches: [],
          },
        },
      });
      const { queryByText } = renderWithUser(<LoopCard loop={loop} />);
      expect(queryByText(/Review Cycle/)).not.toBeInTheDocument();
    });
  });

  describe("action buttons - draft", () => {
    test("shows Edit button for draft loops", () => {
      const loop = createLoopWithStatus("draft" as any);
      const onClick = mock();
      const { getByRole } = renderWithUser(
        <LoopCard loop={loop} onClick={onClick} />
      );
      expect(getByRole("button", { name: "Edit" })).toBeInTheDocument();
    });

    test("Edit button calls onClick with stopPropagation", async () => {
      const loop = createLoopWithStatus("draft" as any);
      const onClick = mock();
      const { getByRole, user } = renderWithUser(
        <LoopCard loop={loop} onClick={onClick} />
      );
      await user.click(getByRole("button", { name: "Edit" }));
      expect(onClick).toHaveBeenCalled();
    });

    test("shows Delete button for draft loops when onDelete provided", () => {
      const loop = createLoopWithStatus("draft" as any);
      const { getByRole } = renderWithUser(
        <LoopCard loop={loop} onDelete={mock()} />
      );
      expect(getByRole("button", { name: "Delete" })).toBeInTheDocument();
    });

    test("hides Delete button for draft loops when onDelete not provided", () => {
      const loop = createLoopWithStatus("draft" as any);
      const { queryByRole } = renderWithUser(<LoopCard loop={loop} />);
      expect(queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    });
  });

  describe("action buttons - planning", () => {
    test("shows Review Plan button for planning loops", () => {
      const loop = createLoopWithStatus("planning");
      const { getByRole } = renderWithUser(
        <LoopCard loop={loop} onClick={mock()} />
      );
      expect(getByRole("button", { name: "Review Plan" })).toBeInTheDocument();
    });

    test("Review Plan button calls onClick", async () => {
      const loop = createLoopWithStatus("planning");
      const onClick = mock();
      const { getByRole, user } = renderWithUser(
        <LoopCard loop={loop} onClick={onClick} />
      );
      await user.click(getByRole("button", { name: "Review Plan" }));
      expect(onClick).toHaveBeenCalled();
    });
  });

  describe("action buttons - completed/acceptable", () => {
    test("shows Accept button for completed loops with git state", () => {
      const loop = createLoopWithStatus("completed", {
        state: { git: createGitState() },
      });
      const { getByRole } = renderWithUser(
        <LoopCard loop={loop} onAccept={mock()} />
      );
      expect(getByRole("button", { name: "Accept" })).toBeInTheDocument();
    });

    test("Accept button calls onAccept", async () => {
      const loop = createLoopWithStatus("completed", {
        state: { git: createGitState() },
      });
      const onAccept = mock();
      const { getByRole, user } = renderWithUser(
        <LoopCard loop={loop} onAccept={onAccept} />
      );
      await user.click(getByRole("button", { name: "Accept" }));
      expect(onAccept).toHaveBeenCalled();
    });

    test("hides Accept button when onAccept not provided", () => {
      const loop = createLoopWithStatus("completed", {
        state: { git: createGitState() },
      });
      const { queryByRole } = renderWithUser(<LoopCard loop={loop} />);
      expect(queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    });

    test("shows Delete button for completed loops", () => {
      const loop = createLoopWithStatus("completed");
      const { getByRole } = renderWithUser(
        <LoopCard loop={loop} onDelete={mock()} />
      );
      expect(getByRole("button", { name: "Delete" })).toBeInTheDocument();
    });

    test("Delete button calls onDelete", async () => {
      const loop = createLoopWithStatus("completed");
      const onDelete = mock();
      const { getByRole, user } = renderWithUser(
        <LoopCard loop={loop} onDelete={onDelete} />
      );
      await user.click(getByRole("button", { name: "Delete" }));
      expect(onDelete).toHaveBeenCalled();
    });
  });

  describe("action buttons - final state", () => {
    test("shows Purge button for merged loops", () => {
      const loop = createLoopWithStatus("merged");
      const { getByRole } = renderWithUser(
        <LoopCard loop={loop} onPurge={mock()} />
      );
      expect(getByRole("button", { name: "Purge" })).toBeInTheDocument();
    });

    test("Purge button calls onPurge", async () => {
      const loop = createLoopWithStatus("merged");
      const onPurge = mock();
      const { getByRole, user } = renderWithUser(
        <LoopCard loop={loop} onPurge={onPurge} />
      );
      await user.click(getByRole("button", { name: "Purge" }));
      expect(onPurge).toHaveBeenCalled();
    });

    test("shows Purge button for deleted loops", () => {
      const loop = createLoopWithStatus("deleted");
      const { getByRole } = renderWithUser(
        <LoopCard loop={loop} onPurge={mock()} />
      );
      expect(getByRole("button", { name: "Purge" })).toBeInTheDocument();
    });

    test("shows Address Comments button for addressable pushed loops", () => {
      const loop = createLoopWithStatus("pushed", {
        state: {
          reviewMode: {
            addressable: true,
            completionAction: "push",
            reviewCycles: 1,
            reviewBranches: [],
          },
        },
      });
      const { getByRole } = renderWithUser(
        <LoopCard loop={loop} onAddressComments={mock()} />
      );
      expect(getByRole("button", { name: "Address Comments" })).toBeInTheDocument();
    });

    test("Address Comments button calls onAddressComments", async () => {
      const loop = createLoopWithStatus("pushed", {
        state: {
          reviewMode: {
            addressable: true,
            completionAction: "push",
            reviewCycles: 1,
            reviewBranches: [],
          },
        },
      });
      const onAddressComments = mock();
      const { getByRole, user } = renderWithUser(
        <LoopCard loop={loop} onAddressComments={onAddressComments} />
      );
      await user.click(getByRole("button", { name: "Address Comments" }));
      expect(onAddressComments).toHaveBeenCalled();
    });

    test("hides Address Comments for deleted loops even if addressable", () => {
      const loop = createLoopWithStatus("deleted", {
        state: {
          reviewMode: {
            addressable: true,
            completionAction: "push",
            reviewCycles: 1,
            reviewBranches: [],
          },
        },
      });
      const { queryByRole } = renderWithUser(
        <LoopCard loop={loop} onAddressComments={mock()} />
      );
      expect(queryByRole("button", { name: "Address Comments" })).not.toBeInTheDocument();
    });
  });

  describe("rename button", () => {
    test("shows rename button when onRename provided", () => {
      const loop = createLoop();
      const { getByLabelText } = renderWithUser(
        <LoopCard loop={loop} onRename={mock()} />
      );
      expect(getByLabelText("Rename loop")).toBeInTheDocument();
    });

    test("hides rename button when onRename not provided", () => {
      const loop = createLoop();
      const { queryByLabelText } = renderWithUser(<LoopCard loop={loop} />);
      expect(queryByLabelText("Rename loop")).not.toBeInTheDocument();
    });

    test("rename button calls onRename", async () => {
      const loop = createLoop();
      const onRename = mock();
      const { getByLabelText, user } = renderWithUser(
        <LoopCard loop={loop} onRename={onRename} />
      );
      await user.click(getByLabelText("Rename loop"));
      expect(onRename).toHaveBeenCalled();
    });
  });

  describe("card click", () => {
    test("card is clickable when onClick provided", () => {
      const loop = createLoop();
      const { container } = renderWithUser(
        <LoopCard loop={loop} onClick={mock()} />
      );
      const card = container.querySelector("[role='button'], .cursor-pointer");
      expect(card).toBeInTheDocument();
    });
  });
});
