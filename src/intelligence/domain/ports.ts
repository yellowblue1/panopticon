import type { PaneAction } from "../../shared/types";

/**
 * Function type representing a Gemini generateContent call.
 * The infrastructure layer wraps the SDK client into this shape.
 */
export type GenerateContentFn = (
  prompt: string,
  options?: { responseMimeType?: string },
) => Promise<string | null>;

/**
 * Dependencies for summary generation
 */
export interface SummaryDeps {
  generateContent: GenerateContentFn;
}

/**
 * Dependencies for action detection
 */
export interface ActionDeps {
  generateContent: GenerateContentFn;
}

const VALID_ACTION_TYPES = new Set(["choices", "yesno", "freeform", "none"]);

/**
 * Validate that a parsed object is a valid PaneAction.
 */
export function isValidPaneAction(parsed: unknown): parsed is PaneAction {
  if (typeof parsed !== "object" || parsed === null) return false;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.type !== "string") return false;
  return VALID_ACTION_TYPES.has(obj.type);
}
