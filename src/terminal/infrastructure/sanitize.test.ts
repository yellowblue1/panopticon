import { describe, expect, it } from "bun:test";
import { sanitizePaneContent } from "./sanitize";

const ESC = "\x1b";

describe("sanitizePaneContent", () => {
  // dim text stripping (ESC[2m ... ESC[22m/0m/m)
  it("removes dim text with ESC[22m terminator", () => {
    const input = `visible ${ESC}[2msuggestion${ESC}[22m after`;
    expect(sanitizePaneContent(input)).toBe("visible after");
  });

  it("removes dim text terminated by reset (ESC[0m)", () => {
    const input = `before ${ESC}[2mghost${ESC}[0m after`;
    expect(sanitizePaneContent(input)).toBe("before after");
  });

  it("removes dim text terminated by bare ESC[m", () => {
    const input = `before ${ESC}[2mghost${ESC}[m after`;
    expect(sanitizePaneContent(input)).toBe("before after");
  });

  it("removes multiple dim blocks", () => {
    const input = `a ${ESC}[2mx${ESC}[22m b ${ESC}[2my${ESC}[0m c`;
    expect(sanitizePaneContent(input)).toBe("a b c");
  });

  it("removes dim block with nested ANSI codes inside", () => {
    const input = `start ${ESC}[2m${ESC}[33myellow dim${ESC}[39m${ESC}[22m end`;
    expect(sanitizePaneContent(input)).toBe("start end");
  });

  it("removes dim text at end of line", () => {
    const input = `prompt> ${ESC}[2msuggestion${ESC}[22m`;
    expect(sanitizePaneContent(input)).toBe("prompt> ");
  });

  it("handles multiline dim blocks", () => {
    const input = `line1\n${ESC}[2mfaint\ntext${ESC}[22m\nline3`;
    expect(sanitizePaneContent(input)).toBe("line1\n\nline3");
  });

  // ANSI escape stripping
  it("strips color codes", () => {
    const input = `${ESC}[32mgreen${ESC}[0m text`;
    expect(sanitizePaneContent(input)).toBe("green text");
  });

  it("strips bold and underline", () => {
    const input = `${ESC}[1mbold${ESC}[22m ${ESC}[4munderline${ESC}[24m`;
    expect(sanitizePaneContent(input)).toBe("bold underline");
  });

  it("strips cursor movement sequences", () => {
    const input = `${ESC}[10Ahello${ESC}[5B`;
    expect(sanitizePaneContent(input)).toBe("hello");
  });

  // Pipeline integration
  it("passes through plain text unchanged", () => {
    expect(sanitizePaneContent("hello world")).toBe("hello world");
  });

  it("runs full pipeline: strip dim, strip ANSI, collapse spaces", () => {
    const input = `${ESC}[1mBold${ESC}[22m visible ${ESC}[2msuggestion${ESC}[22m text`;
    const result = sanitizePaneContent(input);
    expect(result).toBe("Bold visible text");
  });

  it("handles realistic Claude Code suggestion scenario", () => {
    const input = [
      `${ESC}[1m❯${ESC}[22m ${ESC}[32mbun test${ESC}[0m`,
      `${ESC}[2m --cwd tools/crux-monitor${ESC}[22m`,
      "PASS src/tmux/utils.test.ts",
    ].join("\n");
    const result = sanitizePaneContent(input);
    expect(result).toBe("❯ bun test\n\nPASS src/tmux/utils.test.ts");
  });

  it("collapses double spaces left by removal", () => {
    const input = `word1  ${ESC}[2mghost${ESC}[22m  word2`;
    const result = sanitizePaneContent(input);
    expect(result).toBe("word1 word2");
  });
});
