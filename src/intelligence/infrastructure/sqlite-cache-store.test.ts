import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteCacheStore } from "./sqlite-cache-store";

describe("SqliteCacheStore", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "panopticon-test-"));
    dbPath = join(tempDir, "test-cache.sqlite3");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createStore<T>(
    overrides?: Partial<{
      tableName: string;
      ttlMs: number;
      maxSize: number;
      serialize: (value: T) => string;
      deserialize: (raw: string) => T;
    }>,
  ) {
    return new SqliteCacheStore<T>({
      dbPath,
      tableName: "test_cache",
      ...overrides,
    });
  }

  describe("basic CRUD", () => {
    it("returns null for missing key", () => {
      const store = createStore<string>();
      expect(store.get("missing-key")).toBeNull();
      store.close();
    });

    it("stores and retrieves a string value", () => {
      const store = createStore<string>();
      store.set("key1", "hello world");
      expect(store.get("key1")).toBe("hello world");
      store.close();
    });

    it("stores and retrieves a complex object", () => {
      const store = createStore<{ type: string; options: string[] }>();
      const value = { type: "choices", options: ["yes", "no", "maybe"] };
      store.set("key1", value);
      expect(store.get("key1")).toEqual(value);
      store.close();
    });

    it("overwrites existing key with new value", () => {
      const store = createStore<string>();
      store.set("key1", "first");
      store.set("key1", "second");
      expect(store.get("key1")).toBe("second");
      store.close();
    });

    it("deletes a key", () => {
      const store = createStore<string>();
      store.set("key1", "value");
      store.delete("key1");
      expect(store.get("key1")).toBeNull();
      store.close();
    });

    it("clears all entries", () => {
      const store = createStore<string>();
      store.set("key1", "a");
      store.set("key2", "b");
      store.clear();
      expect(store.get("key1")).toBeNull();
      expect(store.get("key2")).toBeNull();
      store.close();
    });
  });

  describe("TTL expiration", () => {
    it("returns null for expired entries", () => {
      const store = createStore<string>({ ttlMs: 50 });
      store.set("key1", "value");

      // Wait for TTL to expire
      const start = Date.now();
      while (Date.now() - start < 60) {
        // busy wait
      }

      expect(store.get("key1")).toBeNull();
      store.close();
    });

    it("returns value before TTL expires", () => {
      const store = createStore<string>({ ttlMs: 5000 });
      store.set("key1", "value");
      expect(store.get("key1")).toBe("value");
      store.close();
    });
  });

  describe("LRU eviction", () => {
    it("evicts oldest entries when exceeding max size", () => {
      const store = createStore<string>({ maxSize: 3 });

      store.set("key1", "a");
      store.set("key2", "b");
      store.set("key3", "c");
      store.set("key4", "d"); // Should evict key1

      expect(store.get("key1")).toBeNull();
      expect(store.get("key2")).toBe("b");
      expect(store.get("key3")).toBe("c");
      expect(store.get("key4")).toBe("d");
      store.close();
    });
  });

  describe("startup purge", () => {
    it("purges stale entries on construction", () => {
      // Create store and add an entry
      const store1 = createStore<string>({ ttlMs: 50 });
      store1.set("key1", "value");
      store1.close();

      // Wait for TTL to expire
      const start = Date.now();
      while (Date.now() - start < 60) {
        // busy wait
      }

      // Open a new store — stale entries should be purged
      const store2 = createStore<string>({ ttlMs: 50 });
      expect(store2.get("key1")).toBeNull();
      store2.close();
    });
  });

  describe("table isolation", () => {
    it("two stores with different tables do not interfere", () => {
      const storeA = new SqliteCacheStore<string>({
        dbPath,
        tableName: "table_a",
      });
      const storeB = new SqliteCacheStore<string>({
        dbPath,
        tableName: "table_b",
      });

      storeA.set("key1", "from A");
      storeB.set("key1", "from B");

      expect(storeA.get("key1")).toBe("from A");
      expect(storeB.get("key1")).toBe("from B");

      storeA.clear();
      expect(storeA.get("key1")).toBeNull();
      expect(storeB.get("key1")).toBe("from B");

      storeA.close();
      storeB.close();
    });
  });

  describe("graceful degradation", () => {
    it("returns null from get after close", () => {
      const store = createStore<string>();
      store.set("key1", "value");
      store.close();
      expect(store.get("key1")).toBeNull();
    });

    it("set is a no-op after close", () => {
      const store = createStore<string>();
      store.close();
      // Should not throw
      store.set("key1", "value");
      expect(store.get("key1")).toBeNull();
    });

    it("delete is a no-op after close", () => {
      const store = createStore<string>();
      store.close();
      // Should not throw
      store.delete("key1");
    });

    it("clear is a no-op after close", () => {
      const store = createStore<string>();
      store.close();
      // Should not throw
      store.clear();
    });
  });

  describe("persistence across instances", () => {
    it("data persists when reopening with a new instance", () => {
      const store1 = createStore<string>();
      store1.set("key1", "persistent-value");
      store1.close();

      const store2 = createStore<string>();
      expect(store2.get("key1")).toBe("persistent-value");
      store2.close();
    });
  });
});
