import type { GeminiResponse, SummaryDeps } from "../domain/ports";
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

const MODEL_ID = "gemini-2.5-flash";

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

  const projectId = deps.getGcpProject();
  if (!projectId) {
    return null;
  }

  const accessToken = deps.getAccessToken();
  if (!accessToken) {
    return null;
  }

  const location = deps.getGcpLocation();
  const apiUrl = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${MODEL_ID}:generateContent`;

  const prompt = buildConversationPrompt(conversationTail);

  const requestPromise = (async (): Promise<string | null> => {
    try {
      const startTime = Date.now();
      console.log(
        `${new Date().toISOString()} [Gemini] Requesting summary (input: ${conversationTail.length} chars)`,
      );

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await deps.fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: {
            role: "user",
            parts: { text: prompt },
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.log(
          `${new Date().toISOString()} [Gemini] Request failed: HTTP ${response.status} (${Date.now() - startTime}ms)`,
        );
        return null;
      }

      const data = (await response.json()) as GeminiResponse;
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

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
