import type { ReactNode } from "react";
import { Button } from "../common";
import { getComposeDraftActionLabel, getComposeSubmitActionLabel } from "./types";

interface FormActionsProps {
  isChatMode: boolean;
  isEditing: boolean;
  isEditingDraft: boolean;
  isSubmitting: boolean;
  canSubmit: boolean;
  canSaveDraft: boolean;
  onCancel: () => void;
  onSaveAsDraft: (e: React.MouseEvent) => void;
  leadingActions?: ReactNode;
}

export function FormActions({
  isChatMode,
  isEditing,
  isEditingDraft,
  isSubmitting,
  canSubmit,
  canSaveDraft,
  onCancel,
  onSaveAsDraft,
  leadingActions,
}: FormActionsProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
      <div className="flex flex-wrap items-center gap-2">{leadingActions}</div>

      {/* Right side - Cancel, Save as Draft, and Create/Start buttons */}
      <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 sm:ml-auto">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        {!isChatMode && (!isEditing || isEditingDraft) && (
          <Button
            type="button"
            variant="secondary"
            onClick={onSaveAsDraft}
            disabled={isSubmitting || !canSaveDraft}
            loading={isSubmitting}
          >
            {getComposeDraftActionLabel(isEditingDraft)}
          </Button>
        )}
        <Button type="submit" loading={isSubmitting} disabled={isSubmitting || !canSubmit}>
          {getComposeSubmitActionLabel({
            isChatMode,
            isEditing,
          })}
        </Button>
      </div>
    </div>
  );
}
