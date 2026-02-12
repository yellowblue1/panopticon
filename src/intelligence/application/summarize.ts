import type { SummaryDeps } from "../domain/ports";
import {
  buildConversationPrompt,
  getConversationTail,
  MAX_SUMMARY_LENGTH,
} from "../domain/prompts";
import {
  deleteInflightRequest,
  getCachedSummary,
  getInflightRequest,
  setCachedSummary,
  setInflightRequest,
} from "../infrastructure/summary-cache";

/**
 * Generate a summary from Claude Code conversation using the Gemini API.
 * The conversation parameter is extracted text from the session's JSONL file.
 * All dependencies must be explicitly provided (no defaults).
 */
export async function generatePaneSummary(
  conversation: string,
  deps: SummaryDeps,
): Promise<string | null> {
  if (!conversation.trim()) {
    return null;
  }

  const conversationTail = getConversationTail(conversation);

  const cached = getCachedSummary(conversationTail);
  if (cached !== null) {
    console.log(
      `${new Date().toISOString()} [Gemini] Cache hit (input: ${conversationTail.length} chars): ${cached}`,
    );
    return cached;
  }

  // Deduplicate concurrent requests for the same content
  const existing = getInflightRequest(conversationTail);
  if (existing !== null) {
    console.log(
      `[Gemini] Dedup hit - awaiting in-flight request (input: ${conversationTail.length} chars)`,
    );
    return existing;
  }

  const prompt = buildConversationPrompt(conversationTail);

  const requestPromise = (async (): Promise<string | null> => {
    try {
      const startTime = Date.now();
      console.log(
        `${new Date().toISOString()} [Gemini] Requesting summary (input: ${conversationTail.length} chars)`,
      );

      const text = await deps.generateContent(prompt);

      if (!text) {
        console.log(
          `${new Date().toISOString()} [Gemini] Empty response (${Date.now() - startTime}ms)`,
        );
        return null;
      }

      const summary = text.slice(0, MAX_SUMMARY_LENGTH).trim();
      console.log(
        `${new Date().toISOString()} [Gemini] Summary received (${Date.now() - startTime}ms): ${summary}`,
      );
      setCachedSummary(conversationTail, summary);
      return summary;
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      console.log(`${new Date().toISOString()} [Gemini] Request error: ${message}`);
      return null;
    }
  })();

  setInflightRequest(conversationTail, requestPromise);
  try {
    return await requestPromise;
  } finally {
    deleteInflightRequest(conversationTail);
  }
}
