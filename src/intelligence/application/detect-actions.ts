import type { PaneAction } from "../../shared/types";
import type { ActionDeps } from "../domain/ports";
import { isValidPaneAction } from "../domain/ports";
import { buildActionPrompt, getContentTail } from "../domain/prompts";

const DEFAULT_ACTION: PaneAction = { type: "none" };

/**
 * Detect what pane action the terminal expects using the Gemini API.
 * All dependencies must be explicitly provided (no defaults).
 */
export async function detectPaneActions(content: string, deps: ActionDeps): Promise<PaneAction> {
  if (!content.trim()) {
    return DEFAULT_ACTION;
  }

  const tail = getContentTail(content);

  const result = await deps.cache.fetch(tail, async () => {
    const text = await deps.generateContent(buildActionPrompt(tail), {
      responseMimeType: "application/json",
    });
    if (!text) return null;
    try {
      const parsed: unknown = JSON.parse(text);
      return isValidPaneAction(parsed) ? parsed : null;
    } catch {
      return null;
    }
  });

  return result ?? DEFAULT_ACTION;
}
