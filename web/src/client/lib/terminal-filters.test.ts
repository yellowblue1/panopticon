import { describe, expect, it } from "bun:test";
import { filterHorizontalBorders } from "./terminal-filters";

const ESC = "\x1b";

/** Strip ANSI escape sequences for test assertions. */
function testStripAnsi(input: string): string {
  const CSI = new RegExp(`${ESC}\\[[?]?[0-9;:]*[A-Za-z]`, "g");
  const ESC2 = new RegExp(`${ESC}[A-Za-z@-~]`, "g");
  return input.replace(CSI, "").replace(ESC2, "");
}

describe("filterHorizontalBorders", () => {
  describe("legacy mode (no columns)", () => {
    it("removes lines with only light horizontal borders", () => {
      const input = "visible\n─────────────\nmore visible";
      expect(filterHorizontalBorders(input)).toBe("visible\nmore visible");
    });

    it("removes lines with heavy horizontal borders", () => {
      const input = "text\n━━━━━━━━━━\nmore";
      expect(filterHorizontalBorders(input)).toBe("text\nmore");
    });

    it("removes lines with double horizontal borders", () => {
      const input = "text\n══════════\nmore";
      expect(filterHorizontalBorders(input)).toBe("text\nmore");
    });

    it("removes borders with ANSI escape codes", () => {
      const input = `text\n${ESC}[32m──────────${ESC}[0m\nmore`;
      expect(filterHorizontalBorders(input)).toBe("text\nmore");
    });

    it("removes borders with whitespace padding", () => {
      const input = "text\n  ──────────  \nmore";
      expect(filterHorizontalBorders(input)).toBe("text\nmore");
    });

    it("preserves lines with mixed content", () => {
      const input = "──── @session ──";
      expect(filterHorizontalBorders(input)).toBe("──── @session ──");
    });

    it("preserves empty lines", () => {
      const input = "line1\n\nline2";
      expect(filterHorizontalBorders(input)).toBe("line1\n\nline2");
    });

    it("preserves whitespace-only lines", () => {
      const input = "line1\n   \nline2";
      expect(filterHorizontalBorders(input)).toBe("line1\n   \nline2");
    });

    it("preserves dashed box-drawing lines", () => {
      const input = "╌╌╌╌╌╌╌╌╌╌";
      expect(filterHorizontalBorders(input)).toBe("╌╌╌╌╌╌╌╌╌╌");
    });

    it("preserves prompt marker lines", () => {
      const input = "❯ user input";
      expect(filterHorizontalBorders(input)).toBe("❯ user input");
    });

    it("handles real Claude Code prompt pattern", () => {
      const input = [
        "some output",
        "─────────────────────────────",
        "❯ user input",
        "─────────────────────────────",
        "status bar",
      ].join("\n");
      expect(filterHorizontalBorders(input)).toBe("some output\n❯ user input\nstatus bar");
    });

    it("returns empty string for empty input", () => {
      expect(filterHorizontalBorders("")).toBe("");
    });

    it("returns content unchanged when no borders present", () => {
      const input = "line 1\nline 2\nline 3";
      expect(filterHorizontalBorders(input)).toBe(input);
    });

    it("removes borders with DEC private mode sequences", () => {
      const input = `text\n${ESC}[?7h${ESC}[2m──────────${ESC}[0m\nmore`;
      expect(filterHorizontalBorders(input)).toBe("text\nmore");
    });

    it("removes borders with character set designation sequences", () => {
      const input = `text\n${ESC}(B${ESC}[2m──────────${ESC}[0m\nmore`;
      expect(filterHorizontalBorders(input)).toBe("text\nmore");
    });

    it("removes borders with colon-separated color params", () => {
      const input = `text\n${ESC}[38:5:240m──────────${ESC}[0m\nmore`;
      expect(filterHorizontalBorders(input)).toBe("text\nmore");
    });
  });

  describe("truncation mode (with columns)", () => {
    it("truncates pure border line to column width", () => {
      const border = "─".repeat(80);
      const result = filterHorizontalBorders(border, 40);
      expect(result).toBe("─".repeat(40));
    });

    it("truncates border line with ANSI to column width", () => {
      const line = `${ESC}[38;2;102;178;255m${"─".repeat(80)}${ESC}[39m`;
      const result = filterHorizontalBorders(line, 40);
      expect(testStripAnsi(result)).toBe("─".repeat(40));
    });

    it("truncates mixed border line with embedded label", () => {
      // Real pattern: ──────── @worker-phase2 ──────────
      const line = `${"─".repeat(20)} @worker ${"─".repeat(20)}`;
      const result = filterHorizontalBorders(line, 30);
      // 30 visible chars: 20 borders + " @worker " (9 chars) + 1 border
      expect(result).toBe(`${"─".repeat(20)} @worker ${"─"}`);
    });

    it("does not truncate non-border lines", () => {
      const line = "this is regular text that is longer than 20 chars";
      const result = filterHorizontalBorders(line, 20);
      expect(result).toBe(line);
    });

    it("does not truncate prompt marker lines", () => {
      const line = "❯ some very long user input that goes beyond columns";
      const result = filterHorizontalBorders(line, 20);
      expect(result).toBe(line);
    });

    it("does not truncate status bar lines", () => {
      const line = "[Opus 4.6] 72% context ── INSERT ── accept edits";
      const result = filterHorizontalBorders(line, 30);
      expect(result).toBe(line);
    });

    it("preserves ANSI escape sequences in truncated output", () => {
      const line = `${ESC}[38;2;102;178;255m${"─".repeat(80)}${ESC}[39m`;
      const result = filterHorizontalBorders(line, 10);
      expect(result.startsWith(`${ESC}[38;2;102;178;255m`)).toBe(true);
      expect(result).toBe(`${ESC}[38;2;102;178;255m${"─".repeat(10)}`);
    });

    it("leaves border line unchanged when shorter than columns", () => {
      const border = "─".repeat(30);
      const result = filterHorizontalBorders(border, 80);
      expect(result).toBe(border);
    });

    it("handles real Claude Code prompt pattern", () => {
      const input = [
        "some output text that is quite long",
        `${ESC}[38;2;102;178;255m${"─".repeat(80)}${ESC}[39m`,
        "❯ user input",
        `${ESC}[38;2;102;178;255m${"─".repeat(80)}${ESC}[39m`,
        `${ESC}[38;2;153;153;153m[Opus 4.6] 72% context${ESC}[39m`,
      ].join("\n");
      const result = filterHorizontalBorders(input, 45);
      const lines = result.split("\n");
      expect(lines).toHaveLength(5);
      // Non-border lines preserved as-is
      expect(lines[0]).toBe("some output text that is quite long");
      expect(lines[2]).toBe("❯ user input");
      // Border lines truncated to 45 visible chars
      expect(testStripAnsi(lines[1])).toBe("─".repeat(45));
      expect(testStripAnsi(lines[3])).toBe("─".repeat(45));
      // Status line is NOT border-like (< 50% border chars)
      expect(lines[4]).toBe(`${ESC}[38;2;153;153;153m[Opus 4.6] 72% context${ESC}[39m`);
    });

    it("preserves empty lines", () => {
      const input = "line1\n\nline2";
      expect(filterHorizontalBorders(input, 40)).toBe("line1\n\nline2");
    });

    it("truncates heavy and double borders too", () => {
      expect(filterHorizontalBorders("━".repeat(80), 20)).toBe("━".repeat(20));
      expect(filterHorizontalBorders("═".repeat(80), 20)).toBe("═".repeat(20));
    });

    it("handles border with label and ANSI colors", () => {
      const line = `${ESC}[38;2;102;178;255m${"─".repeat(30)}${ESC}[39m ${ESC}[32m@worker${ESC}[39m ${ESC}[38;2;102;178;255m${"─".repeat(30)}${ESC}[39m`;
      const result = filterHorizontalBorders(line, 45);
      expect(testStripAnsi(result).length).toBe(45);
    });
  });
});
