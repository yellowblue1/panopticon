import type { PaneAction } from "../../shared/types";
import type { ActionDeps } from "../domain/ports";
import { isValidPaneAction } from "../domain/ports";
import { buildActionPrompt, getContentTail } from "../domain/prompts";
import {
  deleteInflightRequest,
  getCachedAction,
  getInflightRequest,
  setCachedAction,
  setInflightRequest,
} from "../infrastructure/action-cache";

const DEFAULT_ACTION: PaneAction = { type: "none" };

/**
 * Detect what pane action the terminal expects using the Gemini API.
 * All dependencies must be explicitly provided (no defaults).
 */
export async function detectPaneActions(content: string, deps: ActionDeps): Promise<PaneAction> {
  if (!content.trim()) {
    return DEFAULT_ACTION;
  }

  const contentTail = getContentTail(content);

  // Check cache
  const cached = getCachedAction(contentTail);
  if (cached !== null) {
    console.log(
      `${new Date().toISOString()} [Gemini Actions] Cache hit (input: ${contentTail.length} chars)`,
    );
    return cached;
  }

  // Deduplicate concurrent requests for the same content
  const existing = getInflightRequest(contentTail);
  if (existing !== null) {
    console.log(
      `${new Date().toISOString()} [Gemini Actions] Dedup hit - awaiting in-flight request (input: ${contentTail.length} chars)`,
    );
    return existing;
  }

  const prompt = buildActionPrompt(contentTail);

  const requestPromise = (async (): Promise<PaneAction> => {
    try {
      const startTime = Date.now();
      console.log(
        `${new Date().toISOString()} [Gemini Actions] Requesting action detection (input: ${contentTail.length} chars, prompt: ${prompt.length} chars)`,
      );
      console.log(`${new Date().toISOString()} [Gemini Actions] Content tail:\n${contentTail}`);

      const text = await deps.generateContent(prompt, {
        responseMimeType: "application/json",
      });

      if (!text) {
        console.log(
          `${new Date().toISOString()} [Gemini Actions] Empty response (${Date.now() - startTime}ms)`,
        );
        return DEFAULT_ACTION;
      }

      const parsed: unknown = JSON.parse(text);
      if (!isValidPaneAction(parsed)) {
        console.log(
          `${new Date().toISOString()} [Gemini Actions] Invalid action type (${Date.now() - startTime}ms)`,
        );
        return DEFAULT_ACTION;
      }

      console.log(
        `${new Date().toISOString()} [Gemini Actions] Action detected (${Date.now() - startTime}ms): ${parsed.type}`,
      );
      setCachedAction(contentTail, parsed);
      return parsed;
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      console.log(`${new Date().toISOString()} [Gemini Actions] Request error: ${message}`);
      return DEFAULT_ACTION;
    }
  })();

  setInflightRequest(contentTail, requestPromise);
  try {
    return await requestPromise;
  } finally {
    deleteInflightRequest(contentTail);
  }
}
