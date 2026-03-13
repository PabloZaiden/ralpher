import { describe, expect, test } from "bun:test";

import { AnswerPlanQuestionRequestSchema } from "../../src/types/schemas/loop";

describe("AnswerPlanQuestionRequestSchema", () => {
  test("accepts non-empty answers and trims surrounding whitespace", () => {
    const result = AnswerPlanQuestionRequestSchema.safeParse({
      answers: [["  Option B  "], [" custom answer "]],
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.answers).toEqual([["Option B"], ["custom answer"]]);
  });

  test("rejects empty answer groups, blank strings, and missing groups", () => {
    expect(AnswerPlanQuestionRequestSchema.safeParse({
      answers: [["valid"], []],
    }).success).toBe(false);

    expect(AnswerPlanQuestionRequestSchema.safeParse({
      answers: [["   "]],
    }).success).toBe(false);

    expect(AnswerPlanQuestionRequestSchema.safeParse({
      answers: [],
    }).success).toBe(false);
  });
});
