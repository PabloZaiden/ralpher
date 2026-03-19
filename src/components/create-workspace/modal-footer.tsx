/**
 * Footer buttons for the CreateWorkspaceModal.
 */

import { Button } from "../common";

interface ModalFooterProps {
  hasActiveProvisioningJob: boolean;
  provisioningStatus: string | undefined;
  canReturnToAutomaticForm: boolean;
  creating: boolean;
  provisioningStarting: boolean;
  mode: "manual" | "automatic";
  isValid: boolean;
  onClose: () => void;
  onBack: () => void;
  onCancelJob: () => void;
}

export function ModalFooter({
  hasActiveProvisioningJob,
  provisioningStatus,
  canReturnToAutomaticForm,
  creating,
  provisioningStarting,
  mode,
  isValid,
  onClose,
  onBack,
  onCancelJob,
}: ModalFooterProps) {
  if (hasActiveProvisioningJob) {
    return (
      <>
        <Button variant="ghost" onClick={onClose}>
          {provisioningStatus === "running" ? "Hide" : "Close"}
        </Button>
        {canReturnToAutomaticForm && (
          <Button onClick={onBack}>
            Back
          </Button>
        )}
        {provisioningStatus === "running" && (
          <Button variant="danger" onClick={onCancelJob}>
            Cancel Job
          </Button>
        )}
      </>
    );
  }

  return (
    <>
      <Button variant="ghost" onClick={onClose} disabled={creating || provisioningStarting}>
        Cancel
      </Button>
      <Button
        type="submit"
        form="create-workspace-form"
        loading={mode === "automatic" ? provisioningStarting : creating}
        disabled={!isValid}
      >
        {mode === "automatic" ? "Start Provisioning" : "Create Workspace"}
      </Button>
    </>
  );
}
