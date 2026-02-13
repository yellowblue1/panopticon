import { describe, expect, it } from "bun:test";
import { applyLineDiff, computeLineDiff, isDiffWorthSending } from "./pane-diff";

describe("computeLineDiff", () => {
  it("returns null for identical content", () => {
    const content = "line1\nline2\nline3";
    expect(computeLineDiff(content, content)).toBeNull();
  });

  it("detects changed lines", () => {
    const prev = "line1\nline2\nline3";
    const curr = "line1\nchanged\nline3";
    const result = computeLineDiff(prev, curr);
    expect(result).toEqual({
      lines: [{ index: 1, content: "changed" }],
      lineCount: 3,
    });
  });

  it("detects multiple changed lines", () => {
    const prev = "a\nb\nc\nd";
    const curr = "a\nB\nc\nD";
    const result = computeLineDiff(prev, curr);
    expect(result).toEqual({
      lines: [
        { index: 1, content: "B" },
        { index: 3, content: "D" },
      ],
      lineCount: 4,
    });
  });

  it("detects appended lines", () => {
    const prev = "line1\nline2";
    const curr = "line1\nline2\nline3";
    const result = computeLineDiff(prev, curr);
    expect(result).toEqual({
      lines: [{ index: 2, content: "line3" }],
      lineCount: 3,
    });
  });

  it("handles line count reduction (scrolling)", () => {
    const prev = "line1\nline2\nline3";
    const curr = "line2\nline3";
    const result = computeLineDiff(prev, curr);
    expect(result).not.toBeNull();
    expect(result?.lineCount).toBe(2);
  });

  it("handles content with ANSI escape codes", () => {
    const prev = "\x1b[32mgreen\x1b[0m\nplain";
    const curr = "\x1b[32mgreen\x1b[0m\n\x1b[31mred\x1b[0m";
    const result = computeLineDiff(prev, curr);
    expect(result).toEqual({
      lines: [{ index: 1, content: "\x1b[31mred\x1b[0m" }],
      lineCount: 2,
    });
  });

  it("handles empty to non-empty", () => {
    const result = computeLineDiff("", "hello");
    expect(result).toEqual({
      lines: [{ index: 0, content: "hello" }],
      lineCount: 1,
    });
  });

  it("handles non-empty to empty", () => {
    const result = computeLineDiff("hello", "");
    expect(result).not.toBeNull();
    expect(result?.lineCount).toBe(1);
    expect(result?.lines).toEqual([{ index: 0, content: "" }]);
  });

  it("returns non-null when only line count changes (truncation)", () => {
    const prev = "a\nb\nc";
    const curr = "a";
    const result = computeLineDiff(prev, curr);
    expect(result).not.toBeNull();
    expect(result?.lineCount).toBe(1);
  });
});

describe("applyLineDiff", () => {
  it("applies changed lines", () => {
    const prev = "line1\nline2\nline3";
    const diff = { lines: [{ index: 1, content: "changed" }], lineCount: 3 };
    expect(applyLineDiff(prev, diff)).toBe("line1\nchanged\nline3");
  });

  it("applies appended lines", () => {
    const prev = "line1\nline2";
    const diff = { lines: [{ index: 2, content: "line3" }], lineCount: 3 };
    expect(applyLineDiff(prev, diff)).toBe("line1\nline2\nline3");
  });

  it("handles line count reduction", () => {
    const prev = "line1\nline2\nline3";
    const diff = {
      lines: [
        { index: 0, content: "line2" },
        { index: 1, content: "line3" },
      ],
      lineCount: 2,
    };
    expect(applyLineDiff(prev, diff)).toBe("line2\nline3");
  });

  it("handles empty diff (only line count change)", () => {
    const prev = "a\nb\nc";
    const diff = { lines: [], lineCount: 1 };
    expect(applyLineDiff(prev, diff)).toBe("a");
  });

  it("roundtrips with computeLineDiff - changed line", () => {
    const prev = "line1\nline2\nline3";
    const curr = "line1\nchanged\nline3\nline4";
    const diff = computeLineDiff(prev, curr);
    if (diff === null) throw new Error("Expected non-null diff");
    expect(applyLineDiff(prev, diff)).toBe(curr);
  });

  it("roundtrips with computeLineDiff - ANSI content", () => {
    const prev = "\x1b[32mgreen\x1b[0m\nplain\nmore";
    const curr = "\x1b[32mgreen\x1b[0m\n\x1b[31mred\x1b[0m\nmore\nextra";
    const diff = computeLineDiff(prev, curr);
    if (diff === null) throw new Error("Expected non-null diff");
    expect(applyLineDiff(prev, diff)).toBe(curr);
  });

  it("roundtrips with computeLineDiff - scrolling (lines removed from top)", () => {
    const prev = "line1\nline2\nline3\nline4";
    const curr = "line3\nline4\nline5";
    const diff = computeLineDiff(prev, curr);
    if (diff === null) throw new Error("Expected non-null diff");
    expect(applyLineDiff(prev, diff)).toBe(curr);
  });

  it("roundtrips with computeLineDiff - empty to content", () => {
    const prev = "";
    const curr = "hello\nworld";
    const diff = computeLineDiff(prev, curr);
    if (diff === null) throw new Error("Expected non-null diff");
    expect(applyLineDiff(prev, diff)).toBe(curr);
  });
});

describe("isDiffWorthSending", () => {
  it("returns true for small diffs on large content", () => {
    const lines = [{ index: 5, content: "changed line" }];
    expect(isDiffWorthSending(5000, lines)).toBe(true);
  });

  it("returns false when diff is nearly as large as full content", () => {
    const lines = Array.from({ length: 100 }, (_, i) => ({
      index: i,
      content: "x".repeat(50),
    }));
    expect(isDiffWorthSending(100, lines)).toBe(false);
  });

  it("returns true for a few changed lines on moderate content", () => {
    const lines = [
      { index: 0, content: "short" },
      { index: 5, content: "another" },
    ];
    expect(isDiffWorthSending(2000, lines)).toBe(true);
  });
});
