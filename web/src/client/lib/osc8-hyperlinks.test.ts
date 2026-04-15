import { describe, expect, it } from "bun:test";
import { postprocessOsc8, preprocessOsc8 } from "./osc8-hyperlinks";

const ESC = "\x1b";
const BEL = "\x07";

/** Build an OSC 8 hyperlink sequence using ESC\ as ST */
function osc8(url: string, text: string, params = ""): string {
  return `${ESC}]8;${params};${url}${ESC}\\${text}${ESC}]8;;${ESC}\\`;
}

/** Build an OSC 8 hyperlink sequence using BEL as ST */
function osc8bel(url: string, text: string, params = ""): string {
  return `${ESC}]8;${params};${url}${BEL}${text}${ESC}]8;;${BEL}`;
}

describe("preprocessOsc8", () => {
  it("extracts a basic OSC 8 pair with ESC\\ as ST", () => {
    const input = osc8("https://example.com", "click here");
    const { processed, urls } = preprocessOsc8(input);
    expect(urls).toEqual(["https://example.com"]);
    expect(processed).toContain("click here");
    expect(processed).not.toContain("https://example.com");
  });

  it("extracts a basic OSC 8 pair with BEL as ST", () => {
    const input = osc8bel("https://example.com", "click here");
    const { processed, urls } = preprocessOsc8(input);
    expect(urls).toEqual(["https://example.com"]);
    expect(processed).toContain("click here");
  });

  it("handles params like id=...", () => {
    const input = osc8("https://example.com/pull/135", "#135", "id=122pbn7");
    const { processed, urls } = preprocessOsc8(input);
    expect(urls).toEqual(["https://example.com/pull/135"]);
    expect(processed).toContain("#135");
  });

  it("preserves surrounding text", () => {
    const input = `Created PR ${osc8("https://example.com/pull/1", "#1")} for review`;
    const { processed, urls } = preprocessOsc8(input);
    expect(urls).toEqual(["https://example.com/pull/1"]);
    expect(processed).toMatch(/^Created PR /);
    expect(processed).toMatch(/ for review$/);
    expect(processed).toContain("#1");
  });

  it("handles multiple links", () => {
    const input = `${osc8("https://a.com", "A")} and ${osc8("https://b.com", "B")}`;
    const { processed, urls } = preprocessOsc8(input);
    expect(urls).toEqual(["https://a.com", "https://b.com"]);
    expect(processed).toContain("A");
    expect(processed).toContain("B");
  });

  it("preserves text when URL is empty", () => {
    // Empty URL: ESC]8;; ST (same format as close) — open with no URL
    const input = `${ESC}]8;;${ESC}\\visible${ESC}]8;;${ESC}\\`;
    const { processed, urls } = preprocessOsc8(input);
    expect(urls).toEqual([]);
    expect(processed).toBe("visible");
  });

  it("strips orphaned OSC 8 open sequences", () => {
    const input = `before${ESC}]8;;https://example.com${ESC}\\after`;
    const { processed } = preprocessOsc8(input);
    expect(processed).toBe("beforeafter");
  });

  it("strips orphaned OSC 8 close sequences", () => {
    const input = `before${ESC}]8;;${ESC}\\after`;
    const { processed } = preprocessOsc8(input);
    expect(processed).toBe("beforeafter");
  });

  it("returns text unchanged when no OSC 8 present", () => {
    const input = "plain text with no escapes";
    const { processed, urls } = preprocessOsc8(input);
    expect(processed).toBe(input);
    expect(urls).toEqual([]);
  });

  it("preserves ANSI color codes inside link text", () => {
    const linkText = `${ESC}[32m#135${ESC}[0m`;
    const input = osc8("https://example.com", linkText);
    const { processed } = preprocessOsc8(input);
    // ANSI codes should be preserved for fancy-ansi to process
    expect(processed).toContain(`${ESC}[32m`);
    expect(processed).toContain("#135");
  });
});

describe("postprocessOsc8", () => {
  it("converts markers to anchor tags", () => {
    const { processed, urls } = preprocessOsc8(osc8("https://example.com", "click"));
    const html = postprocessOsc8(processed, urls);
    expect(html).toBe(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer" class="terminal-link">click</a>',
    );
  });

  it('escapes & and " in href', () => {
    const { processed, urls } = preprocessOsc8(osc8("https://example.com?a=1&b=2", "link"));
    const html = postprocessOsc8(processed, urls);
    expect(html).toContain('href="https://example.com?a=1&amp;b=2"');
  });

  it("strips non-http URLs but preserves text", () => {
    const { processed, urls } = preprocessOsc8(osc8("ftp://example.com", "link"));
    const html = postprocessOsc8(processed, urls);
    expect(html).toBe("link");
    expect(html).not.toContain("<a");
  });

  it("returns html unchanged when urls array is empty", () => {
    const html = "<span>hello</span>";
    expect(postprocessOsc8(html, [])).toBe(html);
  });

  it("handles markers with span tags inside (from fancy-ansi)", () => {
    const { processed, urls } = preprocessOsc8(osc8("https://example.com", "#135"));
    // Simulate fancy-ansi wrapping text in a span
    const fancyHtml = processed.replace("#135", '<span style="color:green;">#135</span>');
    const html = postprocessOsc8(fancyHtml, urls);
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('<span style="color:green;">#135</span>');
    expect(html).toContain("</a>");
  });

  it("handles multiple links", () => {
    const input = `${osc8("https://a.com", "A")} ${osc8("https://b.com", "B")}`;
    const { processed, urls } = preprocessOsc8(input);
    const html = postprocessOsc8(processed, urls);
    expect(html).toContain('href="https://a.com"');
    expect(html).toContain('href="https://b.com"');
    expect(html).toContain(">A</a>");
    expect(html).toContain(">B</a>");
  });
});
