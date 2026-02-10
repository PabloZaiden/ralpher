/**
 * Toast notification components.
 *
 * Provides the visual toast notifications and the ToastProvider
 * that wraps the application to enable the toast system.
 *
 * @module components/common/Toast
 */

import type { ReactNode } from "react";
import { ToastContext, useToastState, type Toast as ToastData, type ToastType } from "../../hooks/useToast";

/**
 * Color classes for each toast type.
 */
const TOAST_STYLES: Record<ToastType, { bg: string; border: string; icon: string }> = {
  success: {
    bg: "bg-green-900/90",
    border: "border-green-600/50",
    icon: "text-green-400",
  },
  error: {
    bg: "bg-red-900/90",
    border: "border-red-600/50",
    icon: "text-red-400",
  },
  warning: {
    bg: "bg-yellow-900/90",
    border: "border-yellow-600/50",
    icon: "text-yellow-400",
  },
  info: {
    bg: "bg-blue-900/90",
    border: "border-blue-600/50",
    icon: "text-blue-400",
  },
};

/**
 * SVG icon paths for each toast type.
 */
const TOAST_ICONS: Record<ToastType, string> = {
  success: "M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  error: "M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z",
  warning: "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z",
  info: "M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z",
};

/**
 * A single toast notification item.
 */
function ToastItem({ toast, onDismiss }: { toast: ToastData; onDismiss: (id: string) => void }) {
  const styles = TOAST_STYLES[toast.type];

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 px-4 py-3 rounded-lg border shadow-lg backdrop-blur-sm max-w-sm animate-slide-in ${styles.bg} ${styles.border}`}
    >
      {/* Icon */}
      <svg
        className={`w-5 h-5 flex-shrink-0 mt-0.5 ${styles.icon}`}
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d={TOAST_ICONS[toast.type]} />
      </svg>

      {/* Message */}
      <p className="text-sm text-white/90 flex-1 break-words">{toast.message}</p>

      {/* Dismiss button */}
      <button
        onClick={() => onDismiss(toast.id)}
        className="text-white/50 hover:text-white/80 flex-shrink-0 mt-0.5 transition-colors"
        aria-label="Dismiss notification"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Toast container that renders all active toasts.
 * Positioned fixed in the top-right corner.
 */
function ToastContainer({ toasts, onDismiss }: { toasts: ToastData[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none"
    >
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}

/**
 * Toast provider component. Wrap your app in this to enable the toast system.
 *
 * Usage:
 * ```tsx
 * <ToastProvider>
 *   <App />
 * </ToastProvider>
 * ```
 *
 * Then in any child component:
 * ```tsx
 * const toast = useToast();
 * toast.error("Something went wrong");
 * toast.success("Saved successfully");
 * ```
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const toastState = useToastState();

  return (
    <ToastContext.Provider value={toastState}>
      {children}
      <ToastContainer toasts={toastState.toasts} onDismiss={toastState.dismiss} />
    </ToastContext.Provider>
  );
}
