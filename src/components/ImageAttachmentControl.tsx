import { useEffect, useId, useRef, useState } from "react";
import type { ComposerImageAttachment } from "../types/message-attachments";
import {
  MESSAGE_IMAGE_ACCEPT,
  MESSAGE_IMAGE_ATTACHMENT_LIMIT,
  createComposerImageAttachments,
  revokeComposerImageAttachments,
} from "../lib/image-attachments";

interface ImageAttachmentControlProps {
  attachments: ComposerImageAttachment[];
  onChange: (attachments: ComposerImageAttachment[]) => void;
  disabled?: boolean;
  compact?: boolean;
  hint?: string;
}

export function ImageAttachmentControl({
  attachments,
  onChange,
  disabled = false,
  compact = false,
  hint,
}: ImageAttachmentControlProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef(attachments);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const previous = attachmentsRef.current;
    attachmentsRef.current = attachments;

    // Revoke object URLs for attachments that were removed or replaced.
    const currentIds = new Set(attachments.map((a) => a.id));
    for (const prev of previous) {
      if (!currentIds.has(prev.id)) {
        URL.revokeObjectURL(prev.previewUrl);
      }
    }
  }, [attachments]);

  useEffect(() => {
    return () => {
      revokeComposerImageAttachments(attachmentsRef.current);
    };
  }, []);

  async function handleFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }

    setError(null);

    try {
      const nextAttachments = await createComposerImageAttachments(
        Array.from(fileList),
        attachments.length,
      );
      onChange([...attachments, ...nextAttachments]);
    } catch (attachmentError) {
      setError(String(attachmentError));
    } finally {
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  function handleRemoveAttachment(attachmentId: string) {
    const nextAttachments = attachments.filter((attachment) => attachment.id !== attachmentId);
    const removedAttachment = attachments.find((attachment) => attachment.id === attachmentId);
    if (removedAttachment) {
      URL.revokeObjectURL(removedAttachment.previewUrl);
    }
    onChange(nextAttachments);
    setError(null);
  }

  const buttonLabel = attachments.length > 0
    ? `Add image (${attachments.length}/${MESSAGE_IMAGE_ATTACHMENT_LIMIT})`
    : "Add image";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={MESSAGE_IMAGE_ACCEPT}
          multiple
          className="hidden"
          disabled={disabled}
          onChange={(event) => void handleFilesSelected(event.target.files)}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || attachments.length >= MESSAGE_IMAGE_ATTACHMENT_LIMIT}
          className={`inline-flex items-center gap-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-700 px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:border-gray-400 dark:hover:border-gray-500 disabled:cursor-not-allowed disabled:opacity-50 ${compact ? "" : "text-sm"}`}
        >
          <span aria-hidden="true">📎</span>
          <span>{buttonLabel}</span>
        </button>
        {hint && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {hint}
          </span>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">
          {error.replace(/^Error:\s*/, "")}
        </p>
      )}

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="group relative flex items-center gap-2 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-neutral-800 px-2 py-2"
            >
              <img
                src={attachment.previewUrl}
                alt={attachment.filename}
                className="h-10 w-10 rounded object-cover"
              />
              <div className="min-w-0">
                <p className="max-w-32 truncate text-xs text-gray-700 dark:text-gray-200">
                  {attachment.filename}
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  {Math.max(1, Math.round(attachment.size / 1024))} KB
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleRemoveAttachment(attachment.id)}
                disabled={disabled}
                className="rounded p-1 text-xs text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 disabled:opacity-50"
                aria-label={`Remove ${attachment.filename}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
