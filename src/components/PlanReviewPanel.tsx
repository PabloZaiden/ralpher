/**
 * PlanReviewPanel component for reviewing and providing feedback on plans.
 */

import { useState } from "react";
import { Button, Card } from "./common";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { LogViewer, type LogEntry } from "./LogViewer";
import type { Loop, MessageData, ToolCallData } from "../types";

export interface PlanReviewPanelProps {
  /** The loop in planning mode */
  loop: Loop;
  /** Plan content to display */
  planContent: string;
  /** Whether the plan is ready for acceptance */
  isPlanReady: boolean;
  /** Callback to send feedback */
  onSendFeedback: (feedback: string) => Promise<void>;
  /** Callback to accept the plan */
  onAcceptPlan: () => Promise<void>;
  /** Callback to discard the plan */
  onDiscardPlan: () => Promise<void>;
  /** Messages for the log viewer */
  messages?: MessageData[];
  /** Tool calls for the log viewer */
  toolCalls?: ToolCallData[];
  /** Logs for the log viewer */
  logs?: LogEntry[];
}

type PlanTab = "plan" | "log";

export function PlanReviewPanel({
  loop,
  planContent,
  isPlanReady,
  onSendFeedback,
  onAcceptPlan,
  onDiscardPlan,
  messages = [],
  toolCalls = [],
  logs = [],
}: PlanReviewPanelProps) {
  const [feedback, setFeedback] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<PlanTab>("plan");

  const feedbackRounds = loop.state.planMode?.feedbackRounds ?? 0;
  const hasActivity = messages.length > 0 || toolCalls.length > 0 || logs.length > 0;

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

  const tabs: { id: PlanTab; label: string }[] = [
    { id: "plan", label: "Plan" },
    { id: "log", label: "Activity Log" },
  ];

  return (
    <div className="space-y-4 flex-1 min-h-0 overflow-auto dark-scrollbar">
      {/* Tab navigation */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`relative px-2 sm:px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
            }`}
          >
            <span className="flex items-center gap-2">
              {tab.label}
              {tab.id === "log" && hasActivity && activeTab !== "log" && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500" />
                </span>
              )}
            </span>
          </button>
        ))}
        {feedbackRounds > 0 && (
          <span className="ml-auto flex items-center text-sm text-gray-600 dark:text-gray-400 px-4">
            Feedback rounds: {feedbackRounds}
          </span>
        )}
      </div>

      {/* Tab content */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
        {activeTab === "plan" && (
          <div className="p-6">
            <div className="max-w-none">
              {planContent ? (
                !isPlanReady ? (
                  <div className="relative">
                    <MarkdownRenderer content={planContent} dimmed className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg" />
                    <div className="absolute top-4 right-4 flex items-center gap-3 text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800 px-3 py-2 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
                      <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500" />
                      </span>
                      <span className="text-sm font-medium">AI is still writing...</span>
                    </div>
                  </div>
                ) : (
                  <MarkdownRenderer content={planContent} className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg" />
                )
              ) : (
                <div className="flex items-center gap-3 text-gray-600 dark:text-gray-400">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500" />
                  </span>
                  <span>Waiting for AI to generate plan...</span>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "log" && (
          <LogViewer
            messages={messages}
            toolCalls={toolCalls}
            logs={logs}
            maxHeight="500px"
          />
        )}
      </div>

      {/* Feedback Input */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Provide Feedback
        </h3>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="Enter your feedback on the plan. The AI will update the plan based on your comments."
          className="w-full h-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
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
            disabled={isSubmitting || !isPlanReady || !planContent?.trim()}
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
