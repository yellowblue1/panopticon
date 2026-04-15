/**
 * Process OSC 8 hyperlink escape sequences in terminal output.
 *
 * OSC 8 format: ESC]8;params;uri ST text ESC]8;; ST
 * Where ST = ESC\ or BEL (0x07)
 *
 * fancy-ansi strips OSC 8 sequences AND the visible text between them,
 * so we must pre-process before fancy-ansi and post-process after.
 */

// Unicode Private Use Area characters used as markers that survive
// fancy-ansi's escape-html (which only escapes & < > " ')
const LINK_OPEN = "\uE000";
const LINK_SEP = "\uE001";
const LINK_CLOSE = "\uE002";

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const ST = `(?:${ESC}\\\\|${BEL})`; // String Terminator: ESC\ or BEL

/**
 * Matched OSC 8 hyperlink pair:
 *   ESC]8;params;url ST  text  ESC]8;; ST
 *
 * ST (String Terminator) = ESC\ (\x1b\x5c) or BEL (\x07)
 */
const OSC8_PAIR_RE = new RegExp(
  `${ESC}\\]8;([^;]*);([^${ESC}${BEL}]*?)${ST}([\\s\\S]*?)${ESC}\\]8;;${ST}`,
  "g",
);

/** Orphaned OSC 8 sequences (open or close, after pairs are consumed) */
const OSC8_ORPHAN_RE = new RegExp(`${ESC}\\]8;[^${BEL}${ESC}]*${ST}`, "g");

/**
 * Replace OSC 8 hyperlink pairs with Private Use Area markers,
 * preserving the visible text (which may contain ANSI color codes)
 * so fancy-ansi can still process it.
 *
 * Call this BEFORE fancy-ansi's toHtml().
 */
export function preprocessOsc8(text: string): { processed: string; urls: string[] } {
  const urls: string[] = [];

  let processed = text.replace(OSC8_PAIR_RE, (_, _params, url, linkText) => {
    if (!url) return linkText;
    const index = urls.length;
    urls.push(url);
    return `${LINK_OPEN}${index}${LINK_SEP}${linkText}${LINK_CLOSE}`;
  });

  // Strip any remaining unmatched OSC 8 sequences
  processed = processed.replace(OSC8_ORPHAN_RE, "");

  return { processed, urls };
}

/**
 * Convert Private Use Area markers in HTML output to <a> tags.
 *
 * Call this AFTER fancy-ansi's toHtml() and BEFORE linkifyHtml().
 */
export function postprocessOsc8(html: string, urls: string[]): string {
  if (urls.length === 0) return html;

  return html.replace(
    new RegExp(`${LINK_OPEN}(\\d+)${LINK_SEP}([\\s\\S]*?)${LINK_CLOSE}`, "g"),
    (_, indexStr, content) => {
      const index = Number.parseInt(indexStr, 10);
      const url = urls[index];
      if (!url || !/^https?:\/\//.test(url)) return content;
      const escapedUrl = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
      return `<a href="${escapedUrl}" target="_blank" rel="noopener noreferrer" class="terminal-link">${content}</a>`;
    },
  );
}
