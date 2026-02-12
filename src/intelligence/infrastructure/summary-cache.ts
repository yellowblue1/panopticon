import { TtlCache } from "./cache";

const summaryCache = new TtlCache<string | null>();

export function getCachedSummary(
  conversationTail: string,
  nowFn: () => number = Date.now,
): string | null {
  return summaryCache.getCached(conversationTail, nowFn);
}

export function setCachedSummary(conversationTail: string, summary: string): void {
  summaryCache.setCached(conversationTail, summary);
}

export function getInflightRequest(conversationTail: string): Promise<string | null> | null {
  return summaryCache.getInflightRequest(conversationTail);
}

export function setInflightRequest(
  conversationTail: string,
  promise: Promise<string | null>,
): void {
  summaryCache.setInflightRequest(conversationTail, promise);
}

export function deleteInflightRequest(conversationTail: string): void {
  summaryCache.deleteInflightRequest(conversationTail);
}

/** Clear all cached entries and in-flight requests. Used for test isolation. */
export function clearSummaryCache(): void {
  summaryCache.clear();
}

/** Get the number of cached entries. Used for test assertions. */
export function getSummaryCacheSize(): number {
  return summaryCache.cacheSize;
}

/** Get the number of in-flight requests. Used for test assertions. */
export function getInflightSize(): number {
  return summaryCache.inflightSize;
}
