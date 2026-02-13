/**
 * SQLite-backed persistent cache store using bun:sqlite.
 * Provides L2 persistence behind TtlCache's in-memory L1.
 *
 * All public methods catch errors internally and degrade gracefully
 * (log + return null/no-op) so the in-memory cache always works.
 */

import { Database } from "bun:sqlite";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { PersistentStore } from "./cache";
import { getCacheDir } from "./cache-dir";

const DEFAULT_PERSISTENT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_MAX_PERSISTENT_SIZE = 500;
const DB_FILENAME = "gemini-cache.sqlite3";

interface SqliteCacheStoreOptions<T> {
  dbPath: string;
  tableName: string;
  ttlMs?: number;
  maxSize?: number;
  serialize?: (value: T) => string;
  deserialize?: (raw: string) => T;
}

export class SqliteCacheStore<T> implements PersistentStore<T> {
  private db: Database | null;
  private readonly tableName: string;
  private readonly ttlMs: number;
  private readonly maxSize: number;
  private readonly serialize: (value: T) => string;
  private readonly deserialize: (raw: string) => T;

  constructor(options: SqliteCacheStoreOptions<T>) {
    this.tableName = options.tableName;
    this.ttlMs = options.ttlMs ?? DEFAULT_PERSISTENT_TTL_MS;
    this.maxSize = options.maxSize ?? DEFAULT_MAX_PERSISTENT_SIZE;
    this.serialize = options.serialize ?? ((v: T) => JSON.stringify(v));
    this.deserialize = options.deserialize ?? ((raw: string) => JSON.parse(raw) as T);

    this.db = this.openDatabase(options.dbPath);
  }

  private openDatabase(dbPath: string): Database | null {
    try {
      const db = new Database(dbPath);
      db.exec("PRAGMA journal_mode=WAL");
      db.exec("PRAGMA synchronous=NORMAL");
      db.exec("PRAGMA busy_timeout=1000");
      db.exec(`
				CREATE TABLE IF NOT EXISTS ${this.tableName} (
					key TEXT PRIMARY KEY,
					value TEXT NOT NULL,
					created_at INTEGER NOT NULL
				)
			`);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_created_at ON ${this.tableName}(created_at)`,
      );

      // Purge stale entries on startup
      const cutoff = Date.now() - this.ttlMs;
      db.run(`DELETE FROM ${this.tableName} WHERE created_at < ?`, [cutoff]);

      return db;
    } catch (err) {
      console.error(
        `[Cache] Failed to open SQLite database at ${dbPath}: ${err instanceof Error ? err.message : err}`,
      );
      // Try to recover from corruption by deleting and retrying once
      try {
        if (existsSync(dbPath)) {
          rmSync(dbPath, { force: true });
          // Also remove WAL and SHM files
          rmSync(`${dbPath}-wal`, { force: true });
          rmSync(`${dbPath}-shm`, { force: true });
        }
        const db = new Database(dbPath);
        db.exec("PRAGMA journal_mode=WAL");
        db.exec("PRAGMA synchronous=NORMAL");
        db.exec("PRAGMA busy_timeout=1000");
        db.exec(`
					CREATE TABLE IF NOT EXISTS ${this.tableName} (
						key TEXT PRIMARY KEY,
						value TEXT NOT NULL,
						created_at INTEGER NOT NULL
					)
				`);
        db.exec(
          `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_created_at ON ${this.tableName}(created_at)`,
        );
        console.log("[Cache] Recovered by recreating SQLite database");
        return db;
      } catch (retryErr) {
        console.error(
          `[Cache] Failed to recover SQLite database: ${retryErr instanceof Error ? retryErr.message : retryErr}`,
        );
        return null;
      }
    }
  }

  get(key: string): T | null {
    if (!this.db) return null;
    try {
      const row = this.db
        .query(`SELECT value, created_at FROM ${this.tableName} WHERE key = ?`)
        .get(key) as { value: string; created_at: number } | null;

      if (!row) return null;

      // Check TTL
      if (Date.now() - row.created_at > this.ttlMs) {
        this.db.run(`DELETE FROM ${this.tableName} WHERE key = ?`, [key]);
        return null;
      }

      return this.deserialize(row.value);
    } catch (err) {
      console.error(`[Cache] SQLite get failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  set(key: string, value: T): void {
    if (!this.db) return;
    try {
      const serialized = this.serialize(value);
      this.db.run(
        `INSERT OR REPLACE INTO ${this.tableName} (key, value, created_at) VALUES (?, ?, ?)`,
        [key, serialized, Date.now()],
      );

      // LRU eviction: remove oldest entries if over max size
      const countRow = this.db.query(`SELECT COUNT(*) as cnt FROM ${this.tableName}`).get() as {
        cnt: number;
      };
      if (countRow.cnt > this.maxSize) {
        const excess = countRow.cnt - this.maxSize;
        this.db.run(
          `DELETE FROM ${this.tableName} WHERE key IN (SELECT key FROM ${this.tableName} ORDER BY created_at ASC LIMIT ?)`,
          [excess],
        );
      }
    } catch (err) {
      console.error(`[Cache] SQLite set failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  delete(key: string): void {
    if (!this.db) return;
    try {
      this.db.run(`DELETE FROM ${this.tableName} WHERE key = ?`, [key]);
    } catch (err) {
      console.error(`[Cache] SQLite delete failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  clear(): void {
    if (!this.db) return;
    try {
      this.db.run(`DELETE FROM ${this.tableName}`);
    } catch (err) {
      console.error(`[Cache] SQLite clear failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  close(): void {
    if (!this.db) return;
    try {
      this.db.close();
    } catch (err) {
      console.error(`[Cache] SQLite close failed: ${err instanceof Error ? err.message : err}`);
    }
    this.db = null;
  }
}

/**
 * Factory function to create a SqliteCacheStore with platform-appropriate cache directory.
 * Returns undefined on any failure (TtlCache will operate in-memory only).
 * Skips persistent cache in test environment to avoid filesystem side effects.
 */
export function createSqliteCacheStore<T>(options: {
  tableName: string;
  ttlMs?: number;
  maxSize?: number;
  serialize?: (value: T) => string;
  deserialize?: (raw: string) => T;
}): PersistentStore<T> | undefined {
  // Skip persistent cache in test environment
  if (process.env.NODE_ENV === "test") {
    return undefined;
  }

  try {
    const cacheDir = getCacheDir();
    const dbPath = join(cacheDir, DB_FILENAME);
    return new SqliteCacheStore<T>({ ...options, dbPath });
  } catch (err) {
    console.error(
      `[Cache] Failed to initialize persistent cache: ${err instanceof Error ? err.message : err}`,
    );
    return undefined;
  }
}
