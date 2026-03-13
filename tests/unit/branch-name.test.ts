import { describe, expect, test } from "bun:test";
import {
  buildLoopBranchName,
  buildReviewBranchName,
  normalizeBranchPrefix,
} from "../../src/core/branch-name";

describe("branch-name helpers", () => {
  test("buildLoopBranchName creates title-plus-hash branch names", () => {
    expect(buildLoopBranchName("My Feature", "Test prompt")).toBe("my-feature-46817f3");
  });

  test("buildLoopBranchName sanitizes the title before appending the prompt hash", () => {
    expect(buildLoopBranchName("Team / Infra", "Test prompt")).toBe("team-infra-46817f3");
  });

  test("normalizeBranchPrefix strips invalid characters and empty segments", () => {
    expect(normalizeBranchPrefix(" Team / Infra Tools / ")).toBe("team/infra-tools/");
  });

  test("buildReviewBranchName appends the review cycle to the base branch", () => {
    expect(buildReviewBranchName("my-feature-46817f3", 2)).toBe("my-feature-46817f3-review-2");
  });
});
