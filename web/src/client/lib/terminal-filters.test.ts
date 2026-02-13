import { describe, expect, it } from "bun:test";
import { filterHorizontalBorders } from "./terminal-filters";

const ESC = "\x1b";

describe("filterHorizontalBorders", () => {
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
