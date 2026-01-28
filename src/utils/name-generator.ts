/**
 * Loop name generation utility.
 * Generates meaningful loop names from prompts using opencode.
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
 * - Converts to lowercase
 * - Replaces spaces and underscores with hyphens
 * - Removes special characters except hyphens
 * - Truncates to max 50 characters
 * - Trims leading/trailing hyphens
 * - Removes markdown formatting (backticks, asterisks, etc.)
 */
export function sanitizeLoopName(name: string): string {
  return name
    .replace(/[`*~]/g, "")             // Remove markdown formatting (not underscores)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")       // Replace non-alphanumeric (including _) with -
    .replace(/-+/g, "-")               // Collapse multiple hyphens
    .replace(/^-|-$/g, "")             // Trim leading/trailing hyphens
    .slice(0, 50);                     // Limit length to 50 chars
}

/**
 * Generate a fallback name from the prompt using simple heuristics.
 * Extracts key words from the first 50 chars of the prompt.
 */
function generateFallbackName(prompt: string): string {
  // Take first 50 chars, split by spaces, take first 5 words
  const words = prompt
    .slice(0, 50)
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2)  // Skip very short words
    .slice(0, 5);
  
  if (words.length > 0) {
    return sanitizeLoopName(words.join(" "));
  }
  
  // Ultimate fallback: timestamp-based name
  const now = new Date();
  const timestamp = now.toISOString()
    .replace(/[T:.]/g, "-")
    .replace(/Z$/, "")
    .slice(0, 19);  // YYYY-MM-DD-HH-MM-SS
  return `loop-${timestamp}`;
}

/**
 * Generate a loop name from a prompt using opencode.
 * 
 * This function sends a prompt to opencode asking it to generate a short,
 * descriptive name for a coding task. The name is sanitized and validated
 * before being returned.
 * 
 * If generation fails or times out, falls back to heuristic-based naming
 * or timestamp-based naming.
 * 
 * @param options - Options for name generation
 * @returns A sanitized loop name (kebab-case, max 50 chars)
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

  // Build the prompt for opencode
  const nameGenerationPrompt: PromptInput = {
    parts: [{
      type: "text",
      text: `Generate a short, descriptive name for a coding task based on this prompt:

${truncatedPrompt}

Requirements:
- Maximum 50 characters
- Lowercase with hyphens (kebab-case)
- Capture the main goal/action of the task
- Use action verbs when possible (add, fix, update, refactor, implement, etc.)
- No special characters except hyphens
- No markdown formatting
- Be specific and descriptive

Output ONLY the name, nothing else.`
    }],
  };

  try {
    // Create a promise that rejects after timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Name generation timed out")), timeoutMs);
    });

    // Race between generation and timeout
    const response = await Promise.race([
      backend.sendPrompt(sessionId, nameGenerationPrompt),
      timeoutPromise,
    ]);

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
