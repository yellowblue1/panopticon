import { describe, expect, it } from "bun:test";
import type { PlanDiscoveryDeps } from "../domain/ports";
import {
  deletePlan,
  discoverPlan,
  escapeCwd,
  findSlugForCwd,
  planFileExists,
  readPlanContent,
} from "./discover-plan";

function createMockDeps(overrides: Partial<PlanDiscoveryDeps> = {}): PlanDiscoveryDeps {
  return {
    fileExists: () => false,
    readFileText: () => null,
    listDir: () => [],
    getFileMtime: () => 0,
    homeDir: () => "/home/test",
    deleteFile: () => false,
    ...overrides,
  };
}

describe("escapeCwd", () => {
  it("replaces slashes with dashes", () => {
    expect(escapeCwd("/Users/foo/bar")).toBe("-Users-foo-bar");
  });

  it("handles root path", () => {
    expect(escapeCwd("/")).toBe("-");
  });

  it("handles deeply nested paths with dots", () => {
    expect(escapeCwd("/Users/akirasosa/ghq/github.com/yellowblue1/panopticon")).toBe(
      "-Users-akirasosa-ghq-github-com-yellowblue1-panopticon",
    );
  });
});

describe("findSlugForCwd", () => {
  it("returns null when projects dir does not exist", () => {
    const deps = createMockDeps({ fileExists: () => false });
    expect(findSlugForCwd("/Users/foo/bar", deps)).toBeNull();
  });

  it("returns null when no JSONL files exist", () => {
    const deps = createMockDeps({
      fileExists: () => true,
      listDir: () => ["some-other-file.txt"],
    });
    expect(findSlugForCwd("/Users/foo/bar", deps)).toBeNull();
  });

  it("extracts slug from the first JSONL entry", () => {
    const jsonlContent = [
      JSON.stringify({ type: "user", slug: "cuddly-sprouting-rain", sessionId: "abc" }),
      JSON.stringify({ type: "assistant", slug: "cuddly-sprouting-rain" }),
    ].join("\n");

    const deps = createMockDeps({
      fileExists: () => true,
      listDir: () => ["session-1.jsonl"],
      getFileMtime: () => 1000,
      readFileText: (path) => (path.endsWith(".jsonl") ? jsonlContent : null),
    });

    expect(findSlugForCwd("/Users/foo/bar", deps)).toBe("cuddly-sprouting-rain");
  });

  it("picks the newest JSONL when multiple exist", () => {
    const deps = createMockDeps({
      fileExists: () => true,
      listDir: () => ["old-session.jsonl", "new-session.jsonl"],
      getFileMtime: (path) => (path.includes("new-session") ? 2000 : 1000),
      readFileText: (path) => {
        if (path.includes("new-session")) {
          return JSON.stringify({ slug: "new-slug" });
        }
        if (path.includes("old-session")) {
          return JSON.stringify({ slug: "old-slug" });
        }
        return null;
      },
    });

    expect(findSlugForCwd("/Users/foo/bar", deps)).toBe("new-slug");
  });

  it("skips entries without slug and finds the first with slug", () => {
    const jsonlContent = [
      JSON.stringify({ type: "system", sessionId: "abc" }),
      JSON.stringify({ type: "user", slug: "found-slug", sessionId: "abc" }),
    ].join("\n");

    const deps = createMockDeps({
      fileExists: () => true,
      listDir: () => ["session.jsonl"],
      getFileMtime: () => 1000,
      readFileText: () => jsonlContent,
    });

    expect(findSlugForCwd("/Users/foo/bar", deps)).toBe("found-slug");
  });

  it("skips malformed JSON lines", () => {
    const jsonlContent = ["not json at all", JSON.stringify({ slug: "valid-slug" })].join("\n");

    const deps = createMockDeps({
      fileExists: () => true,
      listDir: () => ["session.jsonl"],
      getFileMtime: () => 1000,
      readFileText: () => jsonlContent,
    });

    expect(findSlugForCwd("/Users/foo/bar", deps)).toBe("valid-slug");
  });

  it("returns null when JSONL has no slug field", () => {
    const jsonlContent = JSON.stringify({ type: "user", sessionId: "abc" });

    const deps = createMockDeps({
      fileExists: () => true,
      listDir: () => ["session.jsonl"],
      getFileMtime: () => 1000,
      readFileText: () => jsonlContent,
    });

    expect(findSlugForCwd("/Users/foo/bar", deps)).toBeNull();
  });
});

describe("readPlanContent", () => {
  it("returns content when plan file exists", () => {
    const deps = createMockDeps({
      readFileText: (path) => (path.endsWith("my-slug.md") ? "# Plan content" : null),
    });

    expect(readPlanContent("my-slug", deps)).toBe("# Plan content");
  });

  it("returns null when plan file does not exist", () => {
    const deps = createMockDeps({ readFileText: () => null });
    expect(readPlanContent("nonexistent", deps)).toBeNull();
  });
});

describe("discoverPlan", () => {
  it("returns PlanInfo when plan exists", () => {
    const jsonlContent = JSON.stringify({ slug: "test-slug" });

    const deps = createMockDeps({
      fileExists: () => true,
      listDir: () => ["session.jsonl"],
      getFileMtime: () => 1000,
      readFileText: (path) => {
        if (path.endsWith(".jsonl")) return jsonlContent;
        if (path.endsWith("test-slug.md")) return "# My Plan";
        return null;
      },
    });

    const result = discoverPlan("/Users/foo/bar", deps);
    expect(result).toEqual({ slug: "test-slug", content: "# My Plan" });
  });

  it("returns null when no slug is found", () => {
    const deps = createMockDeps({ fileExists: () => false });
    expect(discoverPlan("/Users/foo/bar", deps)).toBeNull();
  });

  it("returns null when slug exists but plan file does not", () => {
    const jsonlContent = JSON.stringify({ slug: "orphan-slug" });

    const deps = createMockDeps({
      fileExists: () => true,
      listDir: () => ["session.jsonl"],
      getFileMtime: () => 1000,
      readFileText: (path) => {
        if (path.endsWith(".jsonl")) return jsonlContent;
        return null; // Plan file not found
      },
    });

    expect(discoverPlan("/Users/foo/bar", deps)).toBeNull();
  });
});

describe("planFileExists", () => {
  it("returns true when plan file exists", () => {
    const deps = createMockDeps({
      fileExists: (path) => path === "/home/test/.claude/plans/my-slug.md",
    });
    expect(planFileExists("my-slug", deps)).toBe(true);
  });

  it("returns false when plan file does not exist", () => {
    const deps = createMockDeps({ fileExists: () => false });
    expect(planFileExists("no-slug", deps)).toBe(false);
  });
});

describe("deletePlan", () => {
  it("returns true when plan file is deleted successfully", () => {
    const deps = createMockDeps({
      fileExists: (path) => path === "/home/test/.claude/plans/my-slug.md",
      deleteFile: (path) => path === "/home/test/.claude/plans/my-slug.md",
    });
    expect(deletePlan("my-slug", deps)).toBe(true);
  });

  it("returns false when plan file does not exist", () => {
    const deps = createMockDeps({
      fileExists: () => false,
    });
    expect(deletePlan("nonexistent", deps)).toBe(false);
  });

  it("returns false when deleteFile fails", () => {
    const deps = createMockDeps({
      fileExists: () => true,
      deleteFile: () => false,
    });
    expect(deletePlan("my-slug", deps)).toBe(false);
  });
});
