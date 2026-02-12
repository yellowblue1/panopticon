import type { PaneAction } from "../../shared/types";
import { TtlCache } from "./cache";

const actionCache = new TtlCache<PaneAction>();

export function getCachedAction(
  contentTail: string,
  nowFn: () => number = Date.now,
): PaneAction | null {
  return actionCache.getCached(contentTail, nowFn);
}

export function setCachedAction(contentTail: string, action: PaneAction): void {
  actionCache.setCached(contentTail, action);
}

export function getInflightRequest(contentTail: string): Promise<PaneAction> | null {
  return actionCache.getInflightRequest(contentTail);
}

export function setInflightRequest(contentTail: string, promise: Promise<PaneAction>): void {
  actionCache.setInflightRequest(contentTail, promise);
}

export function deleteInflightRequest(contentTail: string): void {
  actionCache.deleteInflightRequest(contentTail);
}

/** Clear all cached entries and in-flight requests. Used for test isolation. */
export function clearActionCache(): void {
  actionCache.clear();
}

/** Get the number of cached entries. Used for test assertions. */
export function getActionCacheSize(): number {
  return actionCache.cacheSize;
}

/** Get the number of in-flight requests. Used for test assertions. */
export function getInflightSize(): number {
  return actionCache.inflightSize;
}
