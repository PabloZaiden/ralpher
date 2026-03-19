/**
 * Hook for managing plan-question state and submission in LoopDetails.
 */

import { useEffect, useState } from "react";
import type { ToastContextValue } from "../../hooks/useToast";
import type { PendingPlanQuestion } from "../../types/loop";

interface UsePlanQuestionOptions {
  pendingPlanQuestion: PendingPlanQuestion | undefined;
  answerPlanQuestion: (answers: string[][]) => Promise<boolean>;
  toast: ToastContextValue;
}

export interface UsePlanQuestionResult {
  planQuestionSelections: string[][];
  setPlanQuestionSelections: React.Dispatch<React.SetStateAction<string[][]>>;
  planQuestionCustomAnswers: string[];
  setPlanQuestionCustomAnswers: React.Dispatch<React.SetStateAction<string[]>>;
  planQuestionSubmitting: boolean;
  handleAnswerPlanQuestion: () => Promise<void>;
}

export function usePlanQuestion({
  pendingPlanQuestion,
  answerPlanQuestion,
  toast,
}: UsePlanQuestionOptions): UsePlanQuestionResult {
  const [planQuestionSelections, setPlanQuestionSelections] = useState<string[][]>([]);
  const [planQuestionCustomAnswers, setPlanQuestionCustomAnswers] = useState<string[]>([]);
  const [planQuestionSubmitting, setPlanQuestionSubmitting] = useState(false);

  // Reset or initialise selections whenever a new question arrives
  useEffect(() => {
    if (!pendingPlanQuestion) {
      setPlanQuestionSelections([]);
      setPlanQuestionCustomAnswers([]);
      return;
    }

    setPlanQuestionSelections(pendingPlanQuestion.questions.map(() => []));
    setPlanQuestionCustomAnswers(pendingPlanQuestion.questions.map(() => ""));
  }, [pendingPlanQuestion?.requestId]);

  async function handleAnswerPlanQuestion() {
    if (!pendingPlanQuestion) return;

    const answers = pendingPlanQuestion.questions.map((question, index) => {
      const customAnswer = planQuestionCustomAnswers[index]?.trim();
      if (customAnswer) return [customAnswer];
      if (question.multiple) return planQuestionSelections[index] ?? [];
      const selected = planQuestionSelections[index]?.[0];
      return selected ? [selected] : [];
    });

    const hasMissingAnswer = answers.some((answerGroup) => answerGroup.length === 0);
    if (hasMissingAnswer) {
      toast.error("Answer every pending question before submitting.");
      return;
    }

    setPlanQuestionSubmitting(true);
    try {
      const success = await answerPlanQuestion(answers);
      if (!success) {
        toast.error("Failed to answer plan question");
      }
    } finally {
      setPlanQuestionSubmitting(false);
    }
  }

  return {
    planQuestionSelections,
    setPlanQuestionSelections,
    planQuestionCustomAnswers,
    setPlanQuestionCustomAnswers,
    planQuestionSubmitting,
    handleAnswerPlanQuestion,
  };
}
