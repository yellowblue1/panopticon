import { describe, expect, it } from "bun:test";
import { linkifyHtml } from "./linkify-html";

describe("linkifyHtml", () => {
  describe("URL linkification", () => {
    it("wraps a plain URL in an anchor tag", () => {
      const input = "Visit https://example.com for details";
      const result = linkifyHtml(input);
      expect(result).toBe(
        'Visit <a href="https://example.com" target="_blank" rel="noopener noreferrer" class="terminal-link">https://example.com</a> for details',
      );
    });

    it("wraps a URL with a path", () => {
      const input = "See https://github.com/user/repo/pull/57";
      const result = linkifyHtml(input);
      expect(result).toContain('href="https://github.com/user/repo/pull/57"');
    });

    it("handles URL inside a span tag", () => {
      const input = '<span style="color: var(--ansi-blue);">https://example.com</span>';
      const result = linkifyHtml(input);
      expect(result).toBe(
        '<span style="color: var(--ansi-blue);"><a href="https://example.com" target="_blank" rel="noopener noreferrer" class="terminal-link">https://example.com</a></span>',
      );
    });

    it("handles URL with query parameters containing &amp;", () => {
      const input = "https://example.com?a=1&amp;b=2";
      const result = linkifyHtml(input);
      expect(result).toContain('href="https://example.com?a=1&b=2"');
      expect(result).toContain(">https://example.com?a=1&amp;b=2</a>");
    });

    it("strips trailing period", () => {
      const input = "See https://example.com.";
      const result = linkifyHtml(input);
      expect(result).toContain('href="https://example.com"');
      expect(result).toContain("</a>.");
    });

    it("strips trailing comma", () => {
      const input = "https://example.com, and more";
      const result = linkifyHtml(input);
      expect(result).toContain('href="https://example.com"');
      expect(result).toContain("</a>, and more");
    });

    it("strips trailing closing parenthesis", () => {
      const input = "(see https://example.com)";
      const result = linkifyHtml(input);
      expect(result).toContain('href="https://example.com"');
      expect(result).toContain("</a>)");
    });

    it("linkifies multiple URLs on the same line", () => {
      const input = "https://a.com and https://b.com";
      const result = linkifyHtml(input);
      expect(result).toContain('href="https://a.com"');
      expect(result).toContain('href="https://b.com"');
    });

    it("handles http:// URLs", () => {
      const input = "http://example.com";
      const result = linkifyHtml(input);
      expect(result).toContain('href="http://example.com"');
    });

    it("does not modify text without URLs", () => {
      const input = "No URLs here, just text.";
      expect(linkifyHtml(input)).toBe(input);
    });

    it("does not modify HTML tags", () => {
      const input = '<span style="color: var(--ansi-red);">error</span>';
      expect(linkifyHtml(input)).toBe(input);
    });

    it("returns empty string for empty input", () => {
      expect(linkifyHtml("")).toBe("");
    });
  });

  describe("PR reference linkification", () => {
    const repoUrl = "https://github.com/user/repo";

    it("wraps PR #N in an anchor tag", () => {
      const input = "Created PR #57 for review";
      const result = linkifyHtml(input, repoUrl);
      expect(result).toBe(
        'Created <a href="https://github.com/user/repo/pull/57" target="_blank" rel="noopener noreferrer" class="terminal-link">PR #57</a> for review',
      );
    });

    it("handles PR#N without space", () => {
      const input = "See PR#42";
      const result = linkifyHtml(input, repoUrl);
      expect(result).toContain('href="https://github.com/user/repo/pull/42"');
    });

    it("does not linkify PR references when no repo URL provided", () => {
      const input = "Created PR #57 for review";
      expect(linkifyHtml(input)).toBe(input);
      expect(linkifyHtml(input, null)).toBe(input);
    });

    it("handles multiple PR references", () => {
      const input = "Merged PR #10 and PR #20";
      const result = linkifyHtml(input, repoUrl);
      expect(result).toContain('href="https://github.com/user/repo/pull/10"');
      expect(result).toContain('href="https://github.com/user/repo/pull/20"');
    });

    it("handles repo URL with trailing slash", () => {
      const input = "PR #5";
      const result = linkifyHtml(input, "https://github.com/user/repo/");
      expect(result).toContain('href="https://github.com/user/repo/pull/5"');
    });
  });

  describe("combined URL and PR linkification", () => {
    it("linkifies both URLs and PR references in the same text", () => {
      const input = "See https://example.com and PR #57 for details";
      const result = linkifyHtml(input, "https://github.com/user/repo");
      expect(result).toContain('href="https://example.com"');
      expect(result).toContain('href="https://github.com/user/repo/pull/57"');
    });

    it("linkifies content with mixed spans and text", () => {
      const input =
        '<span style="color: var(--ansi-green);">Created PR #42</span> at https://example.com';
      const result = linkifyHtml(input, "https://github.com/user/repo");
      expect(result).toContain('href="https://github.com/user/repo/pull/42"');
      expect(result).toContain('href="https://example.com"');
    });
  });
});
