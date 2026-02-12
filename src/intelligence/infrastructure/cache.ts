/**
 * Generic TTL cache with LRU eviction and in-flight request deduplication.
 * Used by both summary and action caches to avoid duplicate Gemini API calls.
 */

interface CacheEntry<T> {
  value: T;
  createdAt: number;
}

const MAX_CACHE_SIZE = 50;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function computeCacheKey(content: string): string {
  return Bun.hash(content).toString(36);
}

export class TtlCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private inflight = new Map<string, Promise<T>>();

  /**
   * Look up a cached value by content key.
   * Returns null if not cached or if the entry has expired.
   */
  getCached(content: string, nowFn: () => number = Date.now): T | null {
    const key = computeCacheKey(content);
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (nowFn() - entry.createdAt > CACHE_TTL_MS) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  /**
   * Store a value in the cache, keyed by content.
   * Evicts the oldest entry if cache exceeds MAX_CACHE_SIZE.
   */
  setCached(content: string, value: T): void {
    const key = computeCacheKey(content);

    if (this.cache.size >= MAX_CACHE_SIZE && !this.cache.has(key)) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }

    this.cache.set(key, { value, createdAt: Date.now() });
  }

  /**
   * Get an in-flight request promise for the given content.
   * Returns null if no request is currently in-flight.
   */
  getInflightRequest(content: string): Promise<T> | null {
    const key = computeCacheKey(content);
    return this.inflight.get(key) ?? null;
  }

  /**
   * Register an in-flight request promise, keyed by content.
   * The caller must call deleteInflightRequest in a finally block.
   */
  setInflightRequest(content: string, promise: Promise<T>): void {
    const key = computeCacheKey(content);
    this.inflight.set(key, promise);
  }

  /** Remove an in-flight request entry after the request completes or fails. */
  deleteInflightRequest(content: string): void {
    const key = computeCacheKey(content);
    this.inflight.delete(key);
  }

  /** Clear all cached entries and in-flight requests. Used for test isolation. */
  clear(): void {
    this.cache.clear();
    this.inflight.clear();
  }

  /** Get the number of cached entries. Used for test assertions. */
  get cacheSize(): number {
    return this.cache.size;
  }

  /** Get the number of in-flight requests. Used for test assertions. */
  get inflightSize(): number {
    return this.inflight.size;
  }
}
