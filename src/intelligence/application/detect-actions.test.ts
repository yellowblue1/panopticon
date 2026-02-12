import { beforeEach, describe, expect, it } from "bun:test";
import {
  mockFetchNetworkError,
  mockGeminiEmpty,
  mockGeminiError,
  mockGeminiSuccess,
} from "../../__tests__";
import type { PaneAction } from "../../shared/types";
import type { ActionDeps, FetchFn } from "../domain/ports";
import { clearActionCache, getInflightSize } from "../infrastructure/action-cache";
import { detectPaneActions } from "./detect-actions";

describe("detect-actions", () => {
  describe("detectPaneActions", () => {
    const mockDeps = (fetchImpl: FetchFn): ActionDeps => ({
      fetch: fetchImpl,
      getAccessToken: () => "mock-token" as string | null,
      getGcpProject: () => "mock-project" as string | null,
      getGcpLocation: () => "us-central1",
    });

    beforeEach(() => {
      clearActionCache();
    });

    it("returns yesno action on successful API response", async () => {
      const action: PaneAction = { type: "yesno" };
      const result = await detectPaneActions(
        "Do you want to proceed? (y/n)",
        mockDeps(mockGeminiSuccess(JSON.stringify(action))),
      );
      expect(result).toEqual(action);
    });

    it("returns choices action on successful API response", async () => {
      const action: PaneAction = {
        type: "choices",
        options: [
          { label: "1. Create file", value: "1", autoEnter: true },
          { label: "2. Delete file", value: "2", autoEnter: true },
        ],
      };
      const result = await detectPaneActions(
        "Select an option:\n1. Create file\n2. Delete file",
        mockDeps(mockGeminiSuccess(JSON.stringify(action))),
      );
      expect(result).toEqual(action);
    });

    it("returns freeform action on successful API response", async () => {
      const action: PaneAction = { type: "freeform", placeholder: "Enter file path..." };
      const result = await detectPaneActions(
        "Enter the file path:",
        mockDeps(mockGeminiSuccess(JSON.stringify(action))),
      );
      expect(result).toEqual(action);
    });

    it("returns none for empty content", async () => {
      const result = await detectPaneActions(
        "   ",
        mockDeps(mockGeminiSuccess('{"type":"yesno"}')),
      );
      expect(result).toEqual({ type: "none" });
    });

    it("returns none when project is not configured", async () => {
      const result = await detectPaneActions("content", {
        ...mockDeps(mockGeminiSuccess('{"type":"yesno"}')),
        getGcpProject: () => null,
      });
      expect(result).toEqual({ type: "none" });
    });

    it("returns none when access token is unavailable", async () => {
      const result = await detectPaneActions("content", {
        ...mockDeps(mockGeminiSuccess('{"type":"yesno"}')),
        getAccessToken: () => null,
      });
      expect(result).toEqual({ type: "none" });
    });

    it("returns none on API error response", async () => {
      const result = await detectPaneActions("content", mockDeps(mockGeminiError(500)));
      expect(result).toEqual({ type: "none" });
    });

    it("returns none on empty candidates", async () => {
      const result = await detectPaneActions("content", mockDeps(mockGeminiEmpty()));
      expect(result).toEqual({ type: "none" });
    });

    it("returns none on network error", async () => {
      const result = await detectPaneActions("content", mockDeps(mockFetchNetworkError()));
      expect(result).toEqual({ type: "none" });
    });

    it("returns none on invalid JSON from Gemini", async () => {
      const result = await detectPaneActions(
        "content",
        mockDeps(mockGeminiSuccess("not valid json")),
      );
      expect(result).toEqual({ type: "none" });
    });

    it("returns none on invalid action type", async () => {
      const result = await detectPaneActions(
        "content",
        mockDeps(mockGeminiSuccess('{"type":"unknown_type"}')),
      );
      expect(result).toEqual({ type: "none" });
    });

    describe("caching", () => {
      it("returns cached action on second call with same content", async () => {
        let callCount = 0;
        const countingFetch: FetchFn = async (url, options) => {
          callCount++;
          return mockGeminiSuccess('{"type":"yesno"}')(url, options);
        };

        const result1 = await detectPaneActions("same content", mockDeps(countingFetch));
        const result2 = await detectPaneActions("same content", mockDeps(countingFetch));

        expect(result1).toEqual({ type: "yesno" });
        expect(result2).toEqual({ type: "yesno" });
        expect(callCount).toBe(1);
      });

      it("makes new API call for different content", async () => {
        let callCount = 0;
        const countingFetch: FetchFn = async (url, options) => {
          callCount++;
          return mockGeminiSuccess('{"type":"none"}')(url, options);
        };

        await detectPaneActions("content A", mockDeps(countingFetch));
        await detectPaneActions("content B", mockDeps(countingFetch));

        expect(callCount).toBe(2);
      });

      it("does not cache when API returns error", async () => {
        let callCount = 0;
        const countingErrorFetch: FetchFn = async (url, options) => {
          callCount++;
          return mockGeminiError(500)(url, options);
        };

        await detectPaneActions("content", mockDeps(countingErrorFetch));
        await detectPaneActions("content", mockDeps(countingErrorFetch));

        expect(callCount).toBe(2);
      });
    });

    describe("in-flight deduplication", () => {
      it("concurrent calls with same content only make one API call", async () => {
        let callCount = 0;
        let resolveResponse!: (value: Response) => void;
        const delayedFetch: FetchFn = async () => {
          callCount++;
          return new Promise<Response>((resolve) => {
            resolveResponse = resolve;
          });
        };

        const deps = mockDeps(delayedFetch);

        const p1 = detectPaneActions("same content", deps);
        const p2 = detectPaneActions("same content", deps);
        const p3 = detectPaneActions("same content", deps);

        resolveResponse({
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: '{"type":"yesno"}' }] } }],
          }),
        } as Response);

        const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

        expect(callCount).toBe(1);
        expect(r1).toEqual({ type: "yesno" });
        expect(r2).toEqual({ type: "yesno" });
        expect(r3).toEqual({ type: "yesno" });
      });

      it("in-flight entry is cleaned up after request completes", async () => {
        await detectPaneActions("content", mockDeps(mockGeminiSuccess('{"type":"yesno"}')));
        expect(getInflightSize()).toBe(0);
      });

      it("in-flight entry is cleaned up after request fails", async () => {
        await detectPaneActions("content", mockDeps(mockGeminiError(500)));
        expect(getInflightSize()).toBe(0);
      });
    });
  });
});
