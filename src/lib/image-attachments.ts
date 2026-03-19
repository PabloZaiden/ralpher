import type { ComposerImageAttachment, MessageImageAttachment } from "../types/message-attachments";
import {
  MESSAGE_IMAGE_ACCEPT,
  MESSAGE_IMAGE_ATTACHMENT_LIMIT,
  MESSAGE_IMAGE_ATTACHMENT_MAX_BYTES,
} from "../types/message-attachments";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error(`Failed to read ${file.name}`));
    };
    reader.onerror = () => {
      reject(new Error(`Failed to read ${file.name}`));
    };
    reader.readAsDataURL(file);
  });
}

export async function createComposerImageAttachments(
  files: File[],
  existingCount = 0,
): Promise<ComposerImageAttachment[]> {
  if (existingCount + files.length > MESSAGE_IMAGE_ATTACHMENT_LIMIT) {
    throw new Error(`You can attach up to ${MESSAGE_IMAGE_ATTACHMENT_LIMIT} images at a time.`);
  }

  return Promise.all(files.map(async (file) => {
    if (!file.type.startsWith("image/")) {
      throw new Error(`${file.name} is not an image.`);
    }

    if (file.size > MESSAGE_IMAGE_ATTACHMENT_MAX_BYTES) {
      throw new Error(`${file.name} is larger than ${Math.floor(MESSAGE_IMAGE_ATTACHMENT_MAX_BYTES / (1024 * 1024))}MB.`);
    }

    const dataUrl = await readFileAsDataUrl(file);
    const commaIndex = dataUrl.indexOf(",");
    if (commaIndex === -1) {
      throw new Error(`Failed to parse ${file.name}.`);
    }

    return {
      id: crypto.randomUUID(),
      filename: file.name,
      mimeType: file.type,
      data: dataUrl.slice(commaIndex + 1),
      size: file.size,
      previewUrl: URL.createObjectURL(file),
    };
  }));
}

export function revokeComposerImageAttachments(attachments: ComposerImageAttachment[]): void {
  attachments.forEach((attachment) => {
    URL.revokeObjectURL(attachment.previewUrl);
  });
}

export function toMessageImageAttachments(
  attachments: ComposerImageAttachment[],
): MessageImageAttachment[] {
  return attachments.map(({ previewUrl: _previewUrl, ...attachment }) => attachment);
}

export {
  MESSAGE_IMAGE_ACCEPT,
  MESSAGE_IMAGE_ATTACHMENT_LIMIT,
  MESSAGE_IMAGE_ATTACHMENT_MAX_BYTES,
};
