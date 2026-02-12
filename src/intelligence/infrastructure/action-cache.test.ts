import { beforeEach, describe, expect, it } from "bun:test";
import type { PaneAction } from "../../shared/types";
import {
  clearActionCache,
  deleteInflightRequest,
  getActionCacheSize,
  getCachedAction,
  getInflightRequest,
  getInflightSize,
  setCachedAction,
  setInflightRequest,
} from "./action-cache";

describe("action-cache", () => {
  beforeEach(() => {
    clearActionCache();
  });

  describe("getCachedAction / setCachedAction", () => {
    it("returns null for uncached content", () => {
      expect(getCachedAction("some content")).toBeNull();
    });

    it("returns cached action for same content", () => {
      const action: PaneAction = { type: "yesno" };
      setCachedAction("content A", action);
      expect(getCachedAction("content A")).toEqual(action);
    });

    it("returns null for different content", () => {
      setCachedAction("content A", { type: "yesno" });
      expect(getCachedAction("content B")).toBeNull();
    });

    it("returns null after TTL expires", () => {
      setCachedAction("content A", { type: "yesno" });

      const fiveMinutesLater = () => Date.now() + 5 * 60 * 1000 + 1;
      expect(getCachedAction("content A", fiveMinutesLater)).toBeNull();
    });

    it("returns cached action before TTL expires", () => {
      const action: PaneAction = { type: "yesno" };
      setCachedAction("content A", action);

      const fourMinutesLater = () => Date.now() + 4 * 60 * 1000;
      expect(getCachedAction("content A", fourMinutesLater)).toEqual(action);
    });

    it("removes expired entry from cache", () => {
      setCachedAction("content A", { type: "yesno" });
      expect(getActionCacheSize()).toBe(1);

      const expired = () => Date.now() + 5 * 60 * 1000 + 1;
      getCachedAction("content A", expired);
      expect(getActionCacheSize()).toBe(0);
    });

    it("caches choices action with options", () => {
      const action: PaneAction = {
        type: "choices",
        options: [
          { label: "1", value: "1", autoEnter: true },
          { label: "2", value: "2", autoEnter: true },
        ],
      };
      setCachedAction("content", action);
      expect(getCachedAction("content")).toEqual(action);
    });

    it("caches freeform action with placeholder", () => {
      const action: PaneAction = { type: "freeform", placeholder: "Enter name..." };
      setCachedAction("content", action);
      expect(getCachedAction("content")).toEqual(action);
    });
  });

  describe("eviction", () => {
    it("evicts oldest entry when cache exceeds max size", () => {
      for (let i = 0; i < 50; i++) {
        setCachedAction(`content-${i}`, { type: "none" });
      }
      expect(getActionCacheSize()).toBe(50);

      setCachedAction("content-new", { type: "yesno" });
      expect(getActionCacheSize()).toBe(50);
      expect(getCachedAction("content-0")).toBeNull();
      expect(getCachedAction("content-new")).toEqual({ type: "yesno" });
    });

    it("does not evict when updating existing key", () => {
      for (let i = 0; i < 50; i++) {
        setCachedAction(`content-${i}`, { type: "none" });
      }

      setCachedAction("content-0", { type: "yesno" });
      expect(getActionCacheSize()).toBe(50);
      expect(getCachedAction("content-0")).toEqual({ type: "yesno" });
    });
  });

  describe("clearActionCache", () => {
    it("removes all cached entries", () => {
      setCachedAction("a", { type: "yesno" });
      setCachedAction("b", { type: "none" });
      expect(getActionCacheSize()).toBe(2);

      clearActionCache();
      expect(getActionCacheSize()).toBe(0);
      expect(getCachedAction("a")).toBeNull();
    });
  });

  describe("in-flight deduplication", () => {
    it("returns null when no in-flight request exists", () => {
      expect(getInflightRequest("some content")).toBeNull();
    });

    it("stores and retrieves in-flight promise", () => {
      const promise = Promise.resolve({ type: "yesno" } as PaneAction);
      setInflightRequest("content", promise);
      expect(getInflightRequest("content")).toBe(promise);
    });

    it("returns null after in-flight request is deleted", () => {
      const promise = Promise.resolve({ type: "yesno" } as PaneAction);
      setInflightRequest("content", promise);
      deleteInflightRequest("content");
      expect(getInflightRequest("content")).toBeNull();
    });

    it("returns null for different content", () => {
      const promise = Promise.resolve({ type: "yesno" } as PaneAction);
      setInflightRequest("content A", promise);
      expect(getInflightRequest("content B")).toBeNull();
    });

    it("clearActionCache also clears in-flight entries", () => {
      const promise = Promise.resolve({ type: "yesno" } as PaneAction);
      setInflightRequest("content", promise);
      expect(getInflightSize()).toBe(1);

      clearActionCache();
      expect(getInflightSize()).toBe(0);
      expect(getInflightRequest("content")).toBeNull();
    });

    it("getInflightSize reflects current count", () => {
      expect(getInflightSize()).toBe(0);

      setInflightRequest("a", Promise.resolve({ type: "none" } as PaneAction));
      expect(getInflightSize()).toBe(1);

      setInflightRequest("b", Promise.resolve({ type: "none" } as PaneAction));
      expect(getInflightSize()).toBe(2);

      deleteInflightRequest("a");
      expect(getInflightSize()).toBe(1);
    });
  });
});
