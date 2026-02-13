/**
 * Generic TTL cache with LRU eviction, in-flight request deduplication,
 * and optional persistent backing store (L2).
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

/**
 * Interface for a persistent backing store behind TtlCache.
 * All methods must be synchronous and must never throw.
 * Implementations handle errors internally (log + return null/no-op).
 */
export interface PersistentStore<T> {
  get(key: string): T | null;
  set(key: string, value: T): void;
  delete(key: string): void;
  clear(): void;
  close(): void;
}

export class TtlCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private inflight = new Map<string, Promise<T>>();
  private persistentStore: PersistentStore<T> | null;

  constructor(persistentStore?: PersistentStore<T>) {
    this.persistentStore = persistentStore ?? null;
  }

  /**
   * Look up a cached value by content key.
   * Returns null if not cached or if the entry has expired.
   * On in-memory miss, falls through to persistent store (L2) if available.
   */
  getCached(content: string, nowFn: () => number = Date.now): T | null {
    const key = computeCacheKey(content);
    const entry = this.cache.get(key);

    if (entry) {
      if (nowFn() - entry.createdAt > CACHE_TTL_MS) {
        this.cache.delete(key);
      } else {
        return entry.value;
      }
    }

    // L2: Check persistent store on in-memory miss
    if (this.persistentStore) {
      const persisted = this.persistentStore.get(key);
      if (persisted !== null) {
        // Promote to in-memory hot cache
        this.cache.set(key, { value: persisted, createdAt: Date.now() });
        return persisted;
      }
    }

    return null;
  }

  /**
   * Store a value in the cache, keyed by content.
   * Evicts the oldest entry if cache exceeds MAX_CACHE_SIZE.
   * Writes through to persistent store if available.
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
    this.persistentStore?.set(key, value);
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
    this.persistentStore?.clear();
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
