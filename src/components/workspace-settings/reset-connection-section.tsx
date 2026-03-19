/**
 * Troubleshooting / reset-connection panel within workspace settings.
 */

import { Button } from "../common";
import { RefreshIcon } from "./icons";

interface ResetConnectionSectionProps {
  onResetConnection: () => Promise<boolean>;
  resettingConnection: boolean;
}

export function ResetConnectionSection({
  onResetConnection,
  resettingConnection,
}: ResetConnectionSectionProps) {
  return (
    <div className="border-t border-gray-200 dark:border-gray-700 pt-6 mt-6">
      <div className="p-4 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-900/20">
        <h3 className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-2">
          Troubleshooting
        </h3>
        <p className="text-sm text-amber-700 dark:text-amber-300 mb-4">
          If the connection appears stuck or not responding, reset the connection for this workspace.
          Running loops will be stopped and can be resumed.
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onResetConnection}
          loading={resettingConnection}
        >
          <RefreshIcon className="w-4 h-4 mr-2" />
          Reset Connection
        </Button>
      </div>
    </div>
  );
}
