import type { PaneAction } from "../../shared/types";

export type FetchFn = (url: string | URL | Request, options?: RequestInit) => Promise<Response>;

/** Response shape from Gemini generateContent API */
export interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

/**
 * Dependencies for summary generation
 */
export interface SummaryDeps {
  fetch: FetchFn;
  getAccessToken: () => string | null;
  getGcpProject: () => string | null;
  getGcpLocation: () => string;
}

/**
 * Dependencies for action detection
 */
export interface ActionDeps {
  fetch: FetchFn;
  getAccessToken: () => string | null;
  getGcpProject: () => string | null;
  getGcpLocation: () => string;
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
