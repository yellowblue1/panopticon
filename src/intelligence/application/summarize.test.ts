import { beforeEach, describe, expect, it } from "bun:test";
import {
  mockGenerateContent,
  mockGenerateContentAuthError,
  mockGenerateContentEmpty,
  mockGenerateContentError,
} from "../../__tests__";
import type { GenerateContentFn, SummaryDeps } from "../domain/ports";
import { buildConversationPrompt } from "../domain/prompts";
import { clearSummaryCache, getInflightSize } from "../infrastructure/summary-cache";
import { generatePaneSummary } from "./summarize";

describe("summarize", () => {
  describe("buildConversationPrompt", () => {
    it("includes language instruction", () => {
      const prompt = buildConversationPrompt("test content");
      expect(prompt).toContain("IMPORTANT: Analyze the content");
      expect(prompt).toContain("Your response MUST be in the same language");
    });

    it("includes idle context", () => {
      const prompt = buildConversationPrompt("test content");
      expect(prompt).toContain("appears to be idle");
      expect(prompt).toContain("15 words or less");
    });

    it("includes the content at the end", () => {
      const content = "[user]: Help me fix a bug\n\n[assistant]: Done.";
      const prompt = buildConversationPrompt(content);
      expect(prompt.endsWith(content)).toBe(true);
    });

    it("mentions terminal output context", () => {
      const prompt = buildConversationPrompt("test");
      expect(prompt).toContain("terminal output from a coding agent session");
    });

    it("includes attention detection instructions with bell emoji", () => {
      const prompt = buildConversationPrompt("test");
      expect(prompt).toContain("ATTENTION DETECTION");
      expect(prompt).toContain("\u{1F514}");
      expect(prompt).not.toContain("\u{1F64B}");
    });
  });

  describe("generatePaneSummary", () => {
    const mockDeps = (generateContent: GenerateContentFn): SummaryDeps => ({
      generateContent,
    });

    beforeEach(() => {
      clearSummaryCache();
    });

    it("returns summary on successful API response", async () => {
      const result = await generatePaneSummary(
        "[user]: Which database should we use?\n\n[assistant]: Let me help you decide.",
        mockDeps(mockGenerateContent("Asking which database to use")),
      );

      expect(result).toBe("Asking which database to use");
    });

    it("returns null for empty content", async () => {
      const result = await generatePaneSummary("   ", mockDeps(mockGenerateContent("test")));
      expect(result).toBeNull();
    });

    it("returns null on empty response", async () => {
      const result = await generatePaneSummary("content", mockDeps(mockGenerateContentEmpty()));
      expect(result).toBeNull();
    });

    it("returns null on API error", async () => {
      const result = await generatePaneSummary("content", mockDeps(mockGenerateContentError()));
      expect(result).toBeNull();
    });

    it("returns null on auth error", async () => {
      const result = await generatePaneSummary(
        "content",
        mockDeps(mockGenerateContentAuthError()),
      );
      expect(result).toBeNull();
    });

    it("truncates long summaries to 100 characters", async () => {
      const longSummary = "A".repeat(150);
      const result = await generatePaneSummary(
        "content",
        mockDeps(mockGenerateContent(longSummary)),
      );

      expect(result).not.toBeNull();
      expect(result?.length).toBe(100);
    });

    it("trims whitespace from summary", async () => {
      const result = await generatePaneSummary(
        "content",
        mockDeps(mockGenerateContent("  Summary with spaces  ")),
      );
      expect(result).toBe("Summary with spaces");
    });

    describe("caching", () => {
      it("returns cached summary on second call with same content", async () => {
        let callCount = 0;
        const countingFn: GenerateContentFn = async () => {
          callCount++;
          return "Cached summary";
        };

        const result1 = await generatePaneSummary("same content", mockDeps(countingFn));
        const result2 = await generatePaneSummary("same content", mockDeps(countingFn));

        expect(result1).toBe("Cached summary");
        expect(result2).toBe("Cached summary");
        expect(callCount).toBe(1);
      });

      it("makes new API call for different content", async () => {
        let callCount = 0;
        const countingFn: GenerateContentFn = async () => {
          callCount++;
          return "Summary";
        };

        await generatePaneSummary("content A", mockDeps(countingFn));
        await generatePaneSummary("content B", mockDeps(countingFn));

        expect(callCount).toBe(2);
      });

      it("does not cache when API returns error", async () => {
        let callCount = 0;
        const countingErrorFn: GenerateContentFn = async () => {
          callCount++;
          throw new Error("API error");
        };

        const result1 = await generatePaneSummary("content", mockDeps(countingErrorFn));
        const result2 = await generatePaneSummary("content", mockDeps(countingErrorFn));

        expect(result1).toBeNull();
        expect(result2).toBeNull();
        expect(callCount).toBe(2);
      });

      it("does not cache when API returns empty response", async () => {
        let callCount = 0;
        const countingEmptyFn: GenerateContentFn = async () => {
          callCount++;
          return null;
        };

        await generatePaneSummary("content", mockDeps(countingEmptyFn));
        await generatePaneSummary("content", mockDeps(countingEmptyFn));

        expect(callCount).toBe(2);
      });
    });

    describe("in-flight deduplication", () => {
      it("concurrent calls with same content only make one API call", async () => {
        let callCount = 0;
        let resolveResponse!: (value: string | null) => void;
        const delayedFn: GenerateContentFn = async () => {
          callCount++;
          return new Promise<string | null>((resolve) => {
            resolveResponse = resolve;
          });
        };

        const deps = mockDeps(delayedFn);

        const p1 = generatePaneSummary("same content", deps);
        const p2 = generatePaneSummary("same content", deps);
        const p3 = generatePaneSummary("same content", deps);

        // Resolve the single API call
        resolveResponse("Deduped summary");

        const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

        expect(callCount).toBe(1);
        expect(r1).toBe("Deduped summary");
        expect(r2).toBe("Deduped summary");
        expect(r3).toBe("Deduped summary");
      });

      it("concurrent calls with different content make separate API calls", async () => {
        let callCount = 0;
        const countingFn: GenerateContentFn = async () => {
          callCount++;
          return "Summary";
        };

        const deps = mockDeps(countingFn);

        const [r1, r2] = await Promise.all([
          generatePaneSummary("content A", deps),
          generatePaneSummary("content B", deps),
        ]);

        expect(callCount).toBe(2);
        expect(r1).toBe("Summary");
        expect(r2).toBe("Summary");
      });

      it("in-flight entry is cleaned up after request completes", async () => {
        const deps = mockDeps(mockGenerateContent("Summary"));

        await generatePaneSummary("content", deps);

        expect(getInflightSize()).toBe(0);
      });

      it("in-flight entry is cleaned up after request fails", async () => {
        const deps = mockDeps(mockGenerateContentError());

        await generatePaneSummary("content", deps);

        expect(getInflightSize()).toBe(0);
      });

      it("concurrent calls all get null when API fails", async () => {
        let callCount = 0;
        let rejectResponse!: (reason: Error) => void;
        const delayedFn: GenerateContentFn = async () => {
          callCount++;
          return new Promise<string | null>((_resolve, reject) => {
            rejectResponse = reject;
          });
        };

        const deps = mockDeps(delayedFn);

        const p1 = generatePaneSummary("same content", deps);
        const p2 = generatePaneSummary("same content", deps);

        // Reject the single API call
        rejectResponse(new Error("API error"));

        const [r1, r2] = await Promise.all([p1, p2]);

        expect(callCount).toBe(1);
        expect(r1).toBeNull();
        expect(r2).toBeNull();
      });
    });
  });
});
