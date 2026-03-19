/** Display Settings section: markdown rendering preference. */

import { useMarkdownPreference } from "../../hooks";

export function DisplaySettingsSection() {
  const { enabled: markdownEnabled, toggle: toggleMarkdown, saving: savingMarkdown } = useMarkdownPreference();

  return (
    <div>
      <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-4">
        Display Settings
      </h3>
      <div className="space-y-3 p-4 rounded-lg bg-gray-50 dark:bg-neutral-900">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={markdownEnabled}
            onChange={() => toggleMarkdown()}
            disabled={savingMarkdown}
            className="h-4 w-4 rounded border-gray-300 text-gray-700 focus:ring-gray-500 disabled:opacity-50"
          />
          <div>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Render Markdown
            </span>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              When enabled, markdown content (plan, status, AI response logs) is rendered as formatted HTML.
              When disabled, raw markdown text is shown.
            </p>
          </div>
        </label>
      </div>
    </div>
  );
}
