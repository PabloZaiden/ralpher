/**
 * Error message display for workspace creation forms.
 */

interface FormErrorProps {
  error?: string | null;
}

export function FormError({ error }: FormErrorProps) {
  if (!error) return null;
  return (
    <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
      <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
    </div>
  );
}
