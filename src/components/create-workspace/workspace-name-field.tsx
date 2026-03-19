/**
 * Workspace name input field.
 */

interface WorkspaceNameFieldProps {
  value: string;
  onChange: (value: string) => void;
}

export function WorkspaceNameField({ value, onChange }: WorkspaceNameFieldProps) {
  return (
    <div>
      <label
        htmlFor="workspace-name"
        className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
      >
        Workspace Name <span className="text-red-500">*</span>
      </label>
      <input
        type="text"
        id="workspace-name"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="My Project"
        required
        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-neutral-700 dark:text-gray-100"
      />
    </div>
  );
}
