import { describe, expect, it } from "bun:test";
import {
  mockGenerateContent,
  mockGenerateContentEmpty,
  mockGenerateContentError,
} from "../../__tests__";
import type { PaneAction } from "../../shared/types";
import type { ActionDeps, GenerateContentFn } from "../domain/ports";
import { TtlCache } from "../infrastructure/cache";
import { detectPaneActions } from "./detect-actions";

describe("detect-actions", () => {
  describe("detectPaneActions", () => {
    const mockDeps = (generateContent: GenerateContentFn): ActionDeps => ({
      generateContent,
      cache: new TtlCache<PaneAction>(),
    });

    it("returns yesno action on successful API response", async () => {
      const action: PaneAction = { type: "yesno" };
      const result = await detectPaneActions(
        "Do you want to proceed? (y/n)",
        mockDeps(mockGenerateContent(JSON.stringify(action))),
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
        mockDeps(mockGenerateContent(JSON.stringify(action))),
      );
      expect(result).toEqual(action);
    });

    it("returns freeform action on successful API response", async () => {
      const action: PaneAction = { type: "freeform", placeholder: "Enter file path..." };
      const result = await detectPaneActions(
        "Enter the file path:",
        mockDeps(mockGenerateContent(JSON.stringify(action))),
      );
      expect(result).toEqual(action);
    });

    it("returns none for empty content", async () => {
      const result = await detectPaneActions(
        "   ",
        mockDeps(mockGenerateContent('{"type":"yesno"}')),
      );
      expect(result).toEqual({ type: "none" });
    });

    it("returns none on empty response", async () => {
      const result = await detectPaneActions("content", mockDeps(mockGenerateContentEmpty()));
      expect(result).toEqual({ type: "none" });
    });

    it("returns none on API error", async () => {
      const result = await detectPaneActions("content", mockDeps(mockGenerateContentError()));
      expect(result).toEqual({ type: "none" });
    });

    it("returns none on invalid JSON from Gemini", async () => {
      const result = await detectPaneActions(
        "content",
        mockDeps(mockGenerateContent("not valid json")),
      );
      expect(result).toEqual({ type: "none" });
    });

    it("returns none on invalid action type", async () => {
      const result = await detectPaneActions(
        "content",
        mockDeps(mockGenerateContent('{"type":"unknown_type"}')),
      );
      expect(result).toEqual({ type: "none" });
    });

    describe("caching", () => {
      it("returns cached action on second call with same content", async () => {
        let callCount = 0;
        const countingFn: GenerateContentFn = async () => {
          callCount++;
          return '{"type":"yesno"}';
        };
        const deps = mockDeps(countingFn);

        const result1 = await detectPaneActions("same content", deps);
        const result2 = await detectPaneActions("same content", deps);

        expect(result1).toEqual({ type: "yesno" });
        expect(result2).toEqual({ type: "yesno" });
        expect(callCount).toBe(1);
      });

      it("makes new API call for different content", async () => {
        let callCount = 0;
        const countingFn: GenerateContentFn = async () => {
          callCount++;
          return '{"type":"none"}';
        };
        const deps = mockDeps(countingFn);

        await detectPaneActions("content A", deps);
        await detectPaneActions("content B", deps);

        expect(callCount).toBe(2);
      });

      it("does not cache when API throws", async () => {
        let callCount = 0;
        const countingErrorFn: GenerateContentFn = async () => {
          callCount++;
          throw new Error("API error");
        };
        const deps = mockDeps(countingErrorFn);

        await detectPaneActions("content", deps);
        await detectPaneActions("content", deps);

        expect(callCount).toBe(2);
      });
    });

    describe("in-flight deduplication", () => {
      it("concurrent calls with same content only make one API call", async () => {
        let callCount = 0;
        let resolveResponse!: (value: string | null) => void;
        const delayedFn: GenerateContentFn = () => {
          callCount++;
          return new Promise<string | null>((resolve) => {
            resolveResponse = resolve;
          });
        };

        const deps = mockDeps(delayedFn);

        const p1 = detectPaneActions("same content", deps);
        const p2 = detectPaneActions("same content", deps);
        const p3 = detectPaneActions("same content", deps);

        resolveResponse('{"type":"yesno"}');

        const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

        expect(callCount).toBe(1);
        expect(r1).toEqual({ type: "yesno" });
        expect(r2).toEqual({ type: "yesno" });
        expect(r3).toEqual({ type: "yesno" });
      });
    });
  });
});
