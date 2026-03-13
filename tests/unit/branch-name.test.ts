import { describe, expect, test } from "bun:test";
import { buildLoopBranchName, buildReviewBranchName } from "../../src/core/branch-name";

describe("branch-name helpers", () => {
  test("buildLoopBranchName creates title-plus-hash branch names without a default prefix", () => {
    expect(buildLoopBranchName("", "My Feature", "Test prompt")).toBe("my-feature-46817f3");
  });

  test("buildLoopBranchName preserves an explicit configured prefix", () => {
    expect(buildLoopBranchName("team/", "My Feature", "Test prompt")).toBe("team/my-feature-46817f3");
  });

  test("buildReviewBranchName appends the review cycle to the base branch", () => {
    expect(buildReviewBranchName("my-feature-46817f3", 2)).toBe("my-feature-46817f3-review-2");
  });
});
