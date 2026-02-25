/**
 * Loop name generation utility.
 * Generates meaningful loop names from prompts using the configured agent backend.
 */

import type { PromptInput, AgentResponse } from "../backends/types";

/**
 * Backend interface for name generation.
 * Matches the interface used by LoopEngine.
 */
export interface BackendInterface {
  sendPrompt(sessionId: string, prompt: PromptInput): Promise<AgentResponse>;
}

/**
 * Options for generating a loop name.
 */
export interface GenerateLoopNameOptions {
  /** The prompt describing the task */
  prompt: string;
  /** Backend instance to use for generation */
  backend: BackendInterface;
  /** Session ID to use for the generation */
  sessionId: string;
  /** Timeout in milliseconds (default: 10000) */
  timeoutMs?: number;
}

/**
 * Sanitize a generated loop name.
 * - Removes markdown formatting (backticks, asterisks, etc.)
 * - Removes control characters
 * - Collapses consecutive whitespace to single spaces
 * - Trims leading/trailing whitespace
 * - Truncates to max 100 characters
 * - Preserves spaces and natural casing for readability
 */
export function sanitizeLoopName(name: string): string {
  return name
    .replace(/[`*~#]/g, "")            // Remove markdown formatting
    .replace(/[\x00-\x1F\x7F]/g, "")   // Remove control characters
    .replace(/\s+/g, " ")              // Collapse consecutive whitespace to single space
    .trim()                             // Trim whitespace
    .slice(0, 100);                     // Limit length to 100 chars
}

/**
 * Generate a fallback name from the prompt using simple heuristics.
 * Extracts key words from the first 100 chars of the prompt.
 */
function generateFallbackName(prompt: string): string {
  // Take first 100 chars, split by spaces, take first 8 words
  const words = prompt
    .slice(0, 100)
    .split(/\s+/)
    .filter(w => w.length > 2)  // Skip very short words
    .slice(0, 8);
  
  if (words.length > 0) {
    return sanitizeLoopName(words.join(" "));
  }
  
  // Ultimate fallback: timestamp-based name
  const now = new Date();
  const timestamp = now.toISOString()
    .replace(/T/, " ")
    .replace(/\.\d+Z$/, "")  // \. matches literal period; removes fractional seconds like .123Z
    .slice(0, 19);  // YYYY-MM-DD HH:MM:SS
  return `Loop ${timestamp}`;
}

/**
 * Generate a loop name from a prompt using the configured agent backend.
 * 
 * This function sends a prompt to the backend asking it to generate a short,
 * descriptive title for a coding task. The title is sanitized and validated
 * before being returned.
 * 
 * If generation fails or times out, falls back to heuristic-based naming
 * or timestamp-based naming.
 * 
 * @param options - Options for name generation
 * @returns A sanitized loop title (max 100 chars, preserves spaces and casing)
 * @throws Error if prompt is empty or backend/session is invalid
 */
export async function generateLoopName(options: GenerateLoopNameOptions): Promise<string> {
  const { prompt, backend, sessionId, timeoutMs = 10000 } = options;

  // Validate inputs
  if (!prompt || !prompt.trim()) {
    throw new Error("Prompt cannot be empty");
  }
  if (!backend || !sessionId) {
    throw new Error("Backend and sessionId are required");
  }

  // Truncate prompt for generation (max 1000 chars)
  const truncatedPrompt = prompt.slice(0, 1000);

  // Build the prompt for the backend
  const nameGenerationPrompt: PromptInput = {
    parts: [{
      type: "text",
      text: `Generate a title for a task with the following description. It should be 100 chars or less: ${truncatedPrompt}

Output ONLY the title, nothing else. No quotes, no formatting, no explanation.`
    }],
  };

  try {
    // Create a promise that rejects after timeout, storing the timer ID
    // so we can clear it when the race completes (prevents timer leak).
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("Name generation timed out")), timeoutMs);
    });

    // Race between generation and timeout
    let response: AgentResponse;
    try {
      response = await Promise.race([
        backend.sendPrompt(sessionId, nameGenerationPrompt),
        timeoutPromise,
      ]);
    } finally {
      clearTimeout(timeoutId);
    }

    const generatedName = response.content.trim();

    // Validate the generated name
    if (generatedName && generatedName.length > 0 && generatedName.length <= 100) {
      // Sanitize the name
      const sanitized = sanitizeLoopName(generatedName);
      
      // Make sure sanitization didn't produce an empty string
      if (sanitized && sanitized.length > 0) {
        return sanitized;
      }
    }

    // If validation failed, fall back to heuristics
    return generateFallbackName(prompt);
  } catch (error) {
    // On any error (timeout, backend failure, etc.), fall back
    return generateFallbackName(prompt);
  }
}
