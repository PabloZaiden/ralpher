/**
 * MarkdownRenderer component for rendering markdown content using Bun.markdown.react().
 * Uses Tailwind Typography (prose) classes for styling.
 */

export interface MarkdownRendererProps {
  /** Markdown content to render */
  content: string;
  /** Additional CSS classes for the container */
  className?: string;
  /** Whether to apply reduced opacity (for in-progress content) */
  dimmed?: boolean;
}

/**
 * Renders markdown content as React elements using Bun.markdown.react().
 * Supports all GitHub Flavored Markdown features including tables, strikethrough,
 * task lists, and autolinks.
 */
export function MarkdownRenderer({ content, className = "", dimmed = false }: MarkdownRendererProps) {
  if (!content) {
    return null;
  }

  // Use Bun.markdown.react() to convert markdown to React elements
  // GFM extensions are enabled by default (tables, strikethrough, task lists)
  const rendered = Bun.markdown.react(content, {
    // Custom component overrides for consistent styling
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 dark:text-blue-400 hover:underline"
      >
        {children}
      </a>
    ),
    code: ({ children }) => (
      <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-sm font-mono">
        {children}
      </code>
    ),
    pre: ({ children }) => (
      <pre className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg overflow-x-auto text-sm">
        {children}
      </pre>
    ),
  });

  return (
    <div
      className={`prose prose-sm dark:prose-invert max-w-none ${dimmed ? "opacity-60" : ""} ${className}`.trim()}
    >
      {rendered}
    </div>
  );
}
