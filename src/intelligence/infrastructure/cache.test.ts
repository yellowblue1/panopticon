import { describe, expect, it } from "bun:test";
import { TtlCache } from "./cache";

describe("TtlCache", () => {
  describe("getCached / setCached", () => {
    it("returns null when nothing is cached", () => {
      const cache = new TtlCache<string>();
      expect(cache.getCached("some content")).toBeNull();
    });

    it("returns the cached value when content matches", () => {
      const cache = new TtlCache<string>();
      cache.setCached("content A", "value A");
      expect(cache.getCached("content A")).toBe("value A");
    });

    it("returns null when content does not match", () => {
      const cache = new TtlCache<string>();
      cache.setCached("content A", "value A");
      expect(cache.getCached("content B")).toBeNull();
    });

    it("evicts entries past the TTL", () => {
      const cache = new TtlCache<string>();
      cache.setCached("content A", "value A");

      const fiveMinutesLater = () => Date.now() + 5 * 60 * 1000 + 1;
      expect(cache.getCached("content A", fiveMinutesLater)).toBeNull();
    });

    it("keeps entries within the TTL", () => {
      const cache = new TtlCache<string>();
      cache.setCached("content A", "value A");

      const fourMinutesLater = () => Date.now() + 4 * 60 * 1000;
      expect(cache.getCached("content A", fourMinutesLater)).toBe("value A");
    });

    it("removes the entry when TTL lookup expires it", () => {
      const cache = new TtlCache<string>();
      cache.setCached("content A", "value A");
      expect(cache.cacheSize).toBe(1);

      const expired = () => Date.now() + 5 * 60 * 1000 + 1;
      cache.getCached("content A", expired);
      expect(cache.cacheSize).toBe(0);
    });

    it("evicts the oldest entry once size exceeds the cap", () => {
      const cache = new TtlCache<string>();
      for (let i = 0; i < 50; i++) {
        cache.setCached(`content-${i}`, `value-${i}`);
      }
      expect(cache.cacheSize).toBe(50);

      cache.setCached("content-new", "value-new");
      expect(cache.cacheSize).toBe(50);
      expect(cache.getCached("content-0")).toBeNull();
      expect(cache.getCached("content-new")).toBe("value-new");
    });

    it("does not evict on update of an existing key", () => {
      const cache = new TtlCache<string>();
      for (let i = 0; i < 50; i++) {
        cache.setCached(`content-${i}`, `value-${i}`);
      }

      cache.setCached("content-0", "updated-value-0");
      expect(cache.cacheSize).toBe(50);
      expect(cache.getCached("content-0")).toBe("updated-value-0");
    });
  });

  describe("clear", () => {
    it("clears cached entries", () => {
      const cache = new TtlCache<string>();
      cache.setCached("a", "value-a");
      cache.setCached("b", "value-b");
      expect(cache.cacheSize).toBe(2);

      cache.clear();
      expect(cache.cacheSize).toBe(0);
      expect(cache.getCached("a")).toBeNull();
    });
  });

  describe("fetch", () => {
    it("calls the fetcher on cache miss and caches the value", async () => {
      const cache = new TtlCache<string>();
      let calls = 0;

      const value = await cache.fetch("content", async () => {
        calls++;
        return "produced";
      });

      expect(value).toBe("produced");
      expect(calls).toBe(1);
      expect(cache.getCached("content")).toBe("produced");
    });

    it("returns the cached value on the second call", async () => {
      const cache = new TtlCache<string>();
      let calls = 0;
      const fetcher = async () => {
        calls++;
        return "produced";
      };

      await cache.fetch("content", fetcher);
      const value = await cache.fetch("content", fetcher);

      expect(value).toBe("produced");
      expect(calls).toBe(1);
    });

    it("calls the fetcher again for different content", async () => {
      const cache = new TtlCache<string>();
      let calls = 0;
      const fetcher = async () => {
        calls++;
        return "produced";
      };

      await cache.fetch("content A", fetcher);
      await cache.fetch("content B", fetcher);

      expect(calls).toBe(2);
    });

    it("does not cache when fetcher returns null", async () => {
      const cache = new TtlCache<string>();
      let calls = 0;
      const fetcher = async () => {
        calls++;
        return null;
      };

      const r1 = await cache.fetch("content", fetcher);
      const r2 = await cache.fetch("content", fetcher);

      expect(r1).toBeNull();
      expect(r2).toBeNull();
      expect(calls).toBe(2);
      expect(cache.cacheSize).toBe(0);
    });

    it("does not cache when fetcher throws", async () => {
      const cache = new TtlCache<string>();
      let calls = 0;
      const fetcher = async () => {
        calls++;
        throw new Error("boom");
      };

      const r1 = await cache.fetch("content", fetcher);
      const r2 = await cache.fetch("content", fetcher);

      expect(r1).toBeNull();
      expect(r2).toBeNull();
      expect(calls).toBe(2);
    });

    it("dedupes concurrent calls for the same key", async () => {
      const cache = new TtlCache<string>();
      let calls = 0;
      let resolveResponse!: (value: string | null) => void;
      const fetcher = () => {
        calls++;
        return new Promise<string | null>((resolve) => {
          resolveResponse = resolve;
        });
      };

      const p1 = cache.fetch("content", fetcher);
      const p2 = cache.fetch("content", fetcher);
      const p3 = cache.fetch("content", fetcher);

      resolveResponse("produced");

      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

      expect(calls).toBe(1);
      expect(r1).toBe("produced");
      expect(r2).toBe("produced");
      expect(r3).toBe("produced");
    });

    it("issues separate fetches for concurrent calls with different keys", async () => {
      const cache = new TtlCache<string>();
      let calls = 0;
      const fetcher = async () => {
        calls++;
        return "produced";
      };

      const [r1, r2] = await Promise.all([
        cache.fetch("content A", fetcher),
        cache.fetch("content B", fetcher),
      ]);

      expect(calls).toBe(2);
      expect(r1).toBe("produced");
      expect(r2).toBe("produced");
    });

    it("clears the in-flight slot after the fetch completes", async () => {
      const cache = new TtlCache<string>();
      await cache.fetch("content", async () => "produced");
      expect(cache.inflightSize).toBe(0);
    });

    it("clears the in-flight slot after the fetch fails", async () => {
      const cache = new TtlCache<string>();
      await cache.fetch("content", async () => {
        throw new Error("boom");
      });
      expect(cache.inflightSize).toBe(0);
    });

    it("concurrent callers all observe null when the fetcher rejects", async () => {
      const cache = new TtlCache<string>();
      let calls = 0;
      let rejectResponse!: (reason: Error) => void;
      const fetcher = () => {
        calls++;
        return new Promise<string | null>((_resolve, reject) => {
          rejectResponse = reject;
        });
      };

      const p1 = cache.fetch("content", fetcher);
      const p2 = cache.fetch("content", fetcher);

      rejectResponse(new Error("boom"));

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(calls).toBe(1);
      expect(r1).toBeNull();
      expect(r2).toBeNull();
    });
  });
});
