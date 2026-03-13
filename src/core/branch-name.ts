import { createHash } from "node:crypto";
import { sanitizeBranchName } from "../utils";

const SHORT_PROMPT_HASH_LENGTH = 7;

function buildShortPromptHash(prompt: string): string {
  return createHash("sha1")
    .update(prompt)
    .digest("hex")
    .slice(0, SHORT_PROMPT_HASH_LENGTH);
}

export function buildLoopBranchName(prefix: string, title: string, prompt: string): string {
  const safeTitle = sanitizeBranchName(title);
  const shortPromptHash = buildShortPromptHash(prompt);
  return `${prefix}${safeTitle}-${shortPromptHash}`;
}

export function buildReviewBranchName(baseBranchName: string, reviewCycle: number): string {
  return `${baseBranchName}-review-${reviewCycle}`;
}
