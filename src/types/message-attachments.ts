/**
 * Shared transient image attachment types and limits.
 *
 * Attachments are passed from the browser to ACP as inline image data and are
 * intentionally not persisted in durable loop state.
 */

export const MESSAGE_IMAGE_ATTACHMENT_LIMIT = 3;
export const MESSAGE_IMAGE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Explicit MIME allowlist — excludes image/svg+xml to avoid script-injection risks. */
export const MESSAGE_IMAGE_ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export const MESSAGE_IMAGE_ACCEPT = MESSAGE_IMAGE_ALLOWED_MIME_TYPES.join(",");

export interface MessageImageAttachment {
  id: string;
  filename: string;
  mimeType: string;
  data: string;
  size: number;
}

export interface ComposerImageAttachment extends MessageImageAttachment {
  previewUrl: string;
}
