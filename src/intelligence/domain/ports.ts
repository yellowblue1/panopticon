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
 * Cache port: memoise an idempotent async computation by content key.
 *
 * Contract:
 * - On cache hit, return the cached value without calling the fetcher.
 * - On concurrent calls for the same key, dedupe to a single fetcher call.
 * - The fetcher returns either a value to cache (T) or `null` meaning
 *   "do not cache; the next caller will retry."
 * - Errors thrown from the fetcher are treated identically to a `null` return.
 */
export interface Cache<T> {
  fetch(content: string, fetcher: () => Promise<T | null>): Promise<T | null>;
}

/**
 * Dependencies for summary generation
 */
export interface SummaryDeps {
  generateContent: GenerateContentFn;
  cache: Cache<string>;
}

/**
 * Dependencies for action detection
 */
export interface ActionDeps {
  generateContent: GenerateContentFn;
  cache: Cache<PaneAction>;
}

function isChoiceOption(
  value: unknown,
): value is { label: string; value: string; autoEnter: boolean } {
  if (typeof value !== "object" || value === null) return false;
  const opt = value as Record<string, unknown>;
  return (
    typeof opt.label === "string" &&
    typeof opt.value === "string" &&
    typeof opt.autoEnter === "boolean"
  );
}

/**
 * Validate that a parsed object is a valid PaneAction.
 *
 * Bounds what malformed Gemini output can flow downstream even if a partial
 * prompt-injection succeeds at the language level: shape mismatches are
 * rejected here and the caller falls back to `{type: "none"}`.
 */
export function isValidPaneAction(parsed: unknown): parsed is PaneAction {
  if (typeof parsed !== "object" || parsed === null) return false;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.type !== "string") return false;
  switch (obj.type) {
    case "choices":
      return Array.isArray(obj.options) && obj.options.every(isChoiceOption);
    case "freeform":
      return typeof obj.placeholder === "string";
    case "yesno":
    case "none":
      return true;
    default:
      return false;
  }
}
