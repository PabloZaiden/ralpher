/**
 * AppSettingsPanel and AppSettingsModal assembled from focused sub-components.
 */

import { Button, Modal } from "../common";
import type { WorkspaceExportData, WorkspaceImportResult } from "../../types/workspace";
import { DisplaySettingsSection } from "./display-settings-section";
import { DeveloperSettingsSection } from "./developer-settings-section";
import { ImportExportSection } from "./import-export-section";
import { DangerZoneSection } from "./danger-zone-section";

export interface AppSettingsPanelProps {
  /** Callback to reset all settings (destructive - deletes database) */
  onResetAll?: () => Promise<boolean>;
  /** Whether resetting all is in progress */
  resetting?: boolean;
  /** Callback to kill the server (for container restart) */
  onKillServer?: () => Promise<boolean>;
  /** Whether kill server is in progress */
  killingServer?: boolean;
  /** Callback to export workspace configs */
  onExportConfig?: () => Promise<WorkspaceExportData | null>;
  /** Callback to import workspace configs */
  onImportConfig?: (data: WorkspaceExportData) => Promise<WorkspaceImportResult | null>;
  /** Whether an export/import operation is in progress */
  configSaving?: boolean;
}

export interface AppSettingsModalProps extends AppSettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * AppSettingsPanel provides the shell-native UI for global app settings.
 */
export function AppSettingsPanel({
  onResetAll,
  resetting = false,
  onKillServer,
  killingServer = false,
  onExportConfig,
  onImportConfig,
  configSaving = false,
}: AppSettingsPanelProps) {
  return (
    <div className="space-y-6">
      <DisplaySettingsSection />
      <DeveloperSettingsSection />
      <ImportExportSection
        onExportConfig={onExportConfig}
        onImportConfig={onImportConfig}
        configSaving={configSaving}
      />
      <DangerZoneSection
        onResetAll={onResetAll}
        resetting={resetting}
        onKillServer={onKillServer}
        killingServer={killingServer}
      />
    </div>
  );
}

export function AppSettingsModal({
  isOpen,
  onClose,
  ...props
}: AppSettingsModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="App Settings"
      description="Configure global app preferences"
      size="md"
      footer={(
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      )}
    >
      <AppSettingsPanel {...props} />
    </Modal>
  );
}

export default AppSettingsPanel;
