import type { Cache } from "../domain/ports";

/**
 * Generic TTL cache with LRU eviction, in-flight request deduplication,
 * and optional persistent backing store (L2).
 *
 * The {@link TtlCache.fetch} method is the intended public entry point: it
 * memoises an idempotent async computation by content key, dedupes concurrent
 * callers, persists successes, and never caches failures.
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

interface TtlCacheOptions<T> {
  /** Optional L2 persistent backing store. */
  store?: PersistentStore<T>;
  /** Optional log tag. When set, fetch() logs cache/dedup/fetch events under this tag. */
  tag?: string;
}

export class TtlCache<T> implements Cache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private inflight = new Map<string, Promise<T | null>>();
  private persistentStore: PersistentStore<T> | null;
  private readonly tag: string | null;

  constructor(options: TtlCacheOptions<T> = {}) {
    this.persistentStore = options.store ?? null;
    this.tag = options.tag ?? null;
  }

  /**
   * Memoise an async computation by content key.
   *
   * - Cache hit → return cached value, do not call fetcher.
   * - Inflight hit → await the in-flight promise, do not call fetcher.
   * - Otherwise → call fetcher, register the promise as inflight, await, clean up.
   *
   * The fetcher returns either a value to cache (T) or `null` meaning
   * "do not cache; the next caller will retry." Errors thrown from the fetcher
   * are swallowed and treated identically to a `null` return.
   */
  async fetch(content: string, fetcher: () => Promise<T | null>): Promise<T | null> {
    const key = computeCacheKey(content);

    const cached = this.lookupByKey(key);
    if (cached !== null) {
      this.log(`Cache hit (input: ${content.length} chars)`);
      return cached;
    }

    const existing = this.inflight.get(key);
    if (existing !== undefined) {
      this.log(`Dedup hit (input: ${content.length} chars)`);
      return existing;
    }

    const startedAt = Date.now();
    this.log(`Fetching (input: ${content.length} chars)`);

    const promise = (async (): Promise<T | null> => {
      try {
        const value = await fetcher();
        const elapsedMs = Date.now() - startedAt;
        if (value === null) {
          this.log(`Fetch returned null (${elapsedMs}ms)`);
          return null;
        }
        this.storeByKey(key, value);
        this.log(`Fetched (${elapsedMs}ms)`);
        return value;
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        this.log(`Fetch error (${Date.now() - startedAt}ms): ${message}`);
        return null;
      }
    })();

    this.inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(key);
    }
  }

  /**
   * Look up a cached value by content key.
   * Returns null if not cached or if the entry has expired.
   * On in-memory miss, falls through to persistent store (L2) if available.
   */
  getCached(content: string, nowFn: () => number = Date.now): T | null {
    return this.lookupByKey(computeCacheKey(content), nowFn);
  }

  /**
   * Store a value in the cache, keyed by content.
   * Evicts the oldest entry if cache exceeds MAX_CACHE_SIZE.
   * Writes through to persistent store if available.
   */
  setCached(content: string, value: T): void {
    this.storeByKey(computeCacheKey(content), value);
  }

  /** Clear all cached entries and in-flight requests. */
  clear(): void {
    this.cache.clear();
    this.inflight.clear();
    this.persistentStore?.clear();
  }

  /** Number of cached entries. Useful for tests. */
  get cacheSize(): number {
    return this.cache.size;
  }

  /** Number of in-flight requests. Useful for tests. */
  get inflightSize(): number {
    return this.inflight.size;
  }

  private lookupByKey(key: string, nowFn: () => number = Date.now): T | null {
    const entry = this.cache.get(key);

    if (entry) {
      if (nowFn() - entry.createdAt > CACHE_TTL_MS) {
        this.cache.delete(key);
      } else {
        return entry.value;
      }
    }

    if (this.persistentStore) {
      const persisted = this.persistentStore.get(key);
      if (persisted !== null) {
        // Promote L2 hit into the L1 hot cache.
        this.cache.set(key, { value: persisted, createdAt: Date.now() });
        return persisted;
      }
    }

    return null;
  }

  private storeByKey(key: string, value: T): void {
    if (this.cache.size >= MAX_CACHE_SIZE && !this.cache.has(key)) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }

    this.cache.set(key, { value, createdAt: Date.now() });
    this.persistentStore?.set(key, value);
  }

  private log(message: string): void {
    if (this.tag === null) return;
    console.log(`${new Date().toISOString()} [${this.tag}] ${message}`);
  }
}
