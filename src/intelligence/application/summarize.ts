import type { SummaryDeps } from "../domain/ports";
import {
  buildConversationPrompt,
  getConversationTail,
  MAX_SUMMARY_LENGTH,
} from "../domain/prompts";

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

  const tail = getConversationTail(conversation);

  return deps.cache.fetch(tail, async () => {
    const text = await deps.generateContent(buildConversationPrompt(tail));
    if (!text) return null;
    return text.slice(0, MAX_SUMMARY_LENGTH).trim();
  });
}
