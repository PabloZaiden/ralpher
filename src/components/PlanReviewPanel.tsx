/**
 * PlanReviewPanel component for reviewing and providing feedback on plans.
 */

import { useState } from "react";
import { Button, Card } from "./common";
import type { Loop } from "../types";

export interface PlanReviewPanelProps {
  /** The loop in planning mode */
  loop: Loop;
  /** Plan content to display */
  planContent: string;
  /** Callback to send feedback */
  onSendFeedback: (feedback: string) => Promise<void>;
  /** Callback to accept the plan */
  onAcceptPlan: () => Promise<void>;
  /** Callback to discard the plan */
  onDiscardPlan: () => Promise<void>;
}

export function PlanReviewPanel({
  loop,
  planContent,
  onSendFeedback,
  onAcceptPlan,
  onDiscardPlan,
}: PlanReviewPanelProps) {
  const [feedback, setFeedback] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const feedbackRounds = loop.state.planMode?.feedbackRounds ?? 0;

  const handleSendFeedback = async () => {
    if (!feedback.trim()) return;

    setIsSubmitting(true);
    try {
      await onSendFeedback(feedback);
      setFeedback("");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAcceptPlan = async () => {
    setIsSubmitting(true);
    try {
      await onAcceptPlan();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDiscardPlan = async () => {
    setIsSubmitting(true);
    try {
      await onDiscardPlan();
    } finally {
      setIsSubmitting(false);
      setShowDiscardConfirm(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Plan Content Display */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Plan Review
          </h3>
          {feedbackRounds > 0 && (
            <span className="text-sm text-gray-600 dark:text-gray-400">
              Feedback rounds: {feedbackRounds}
            </span>
          )}
        </div>

        <div className="prose prose-sm dark:prose-invert max-w-none">
          {planContent ? (
            <pre className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg overflow-x-auto text-sm">
              {planContent}
            </pre>
          ) : (
            <p className="text-gray-600 dark:text-gray-400">
              Waiting for AI to generate plan...
            </p>
          )}
        </div>
      </Card>

      {/* Feedback Input */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Provide Feedback
        </h3>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="Enter your feedback on the plan. The AI will update the plan based on your comments."
          className="w-full h-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          disabled={isSubmitting}
        />
        <div className="flex justify-end mt-4">
          <Button
            onClick={handleSendFeedback}
            disabled={!feedback.trim() || isSubmitting}
            variant="primary"
          >
            {isSubmitting ? "Sending..." : "Send Feedback"}
          </Button>
        </div>
      </Card>

      {/* Action Buttons */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Plan Actions
        </h3>
        <div className="flex gap-4">
          <Button
            onClick={handleAcceptPlan}
            disabled={isSubmitting || !planContent}
            variant="primary"
          >
            {isSubmitting ? "Accepting..." : "Accept Plan & Start Loop"}
          </Button>
          <Button
            onClick={() => setShowDiscardConfirm(true)}
            disabled={isSubmitting}
            variant="danger"
          >
            Discard Plan
          </Button>
        </div>
      </Card>

      {/* Discard Confirmation Modal */}
      {showDiscardConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <Card className="max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Discard Plan?
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Are you sure you want to discard this plan? This will delete the loop and all planning work will be lost.
            </p>
            <div className="flex gap-4 justify-end">
              <Button
                onClick={() => setShowDiscardConfirm(false)}
                disabled={isSubmitting}
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                onClick={handleDiscardPlan}
                disabled={isSubmitting}
                variant="danger"
              >
                {isSubmitting ? "Discarding..." : "Discard"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
