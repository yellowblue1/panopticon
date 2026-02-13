const ESC = String.fromCharCode(0x1b);
const ESC_CODE = 0x1b;

// CSI sequences: ESC[ [?] params final-byte — includes DEC private modes (\x1b[?25l etc.)
const CSI_RE = new RegExp(`${ESC}\\[[?]?[0-9;:]*[A-Za-z]`, "g");
// OSC sequences: ESC] ... ST (ESC\\ or BEL)
const OSC_RE = new RegExp(`${ESC}\\][\\s\\S]*?(?:${ESC}\\\\|\\x07)`, "g");
// Character set designation: ESC ( char, ESC ) char — used by tmux for ACS
const CHARSET_RE = new RegExp(`${ESC}[()\\*+][A-Za-z0-9]`, "g");
// Two-byte ESC sequences: ESC followed by a single char (0x40-0x7E)
const ESC2_RE = new RegExp(`${ESC}[A-Za-z@-~]`, "g");

/**
 * Strip all ANSI escape sequences from a string (for pattern matching only).
 */
function stripAnsi(input: string): string {
  return input.replace(CSI_RE, "").replace(OSC_RE, "").replace(CHARSET_RE, "").replace(ESC2_RE, "");
}

/**
 * Advance past an ANSI escape sequence starting at position `i`.
 * Returns the new position after the sequence.
 * If there is no escape sequence at `i`, returns `i` unchanged.
 */
function skipEscapeAt(line: string, i: number): number {
  if (line.charCodeAt(i) !== ESC_CODE || i + 1 >= line.length) return i;
  const next = line.charCodeAt(i + 1);
  if (next === 0x5b) {
    // CSI: ESC[ params final-byte (0x40-0x7e)
    let j = i + 2;
    while (j < line.length && line.charCodeAt(j) < 0x40) j++;
    return j < line.length ? j + 1 : j;
  }
  if (next === 0x5d) {
    // OSC: ESC] ... (ESC\ or BEL)
    let j = i + 2;
    while (j < line.length) {
      if (
        line.charCodeAt(j) === ESC_CODE &&
        j + 1 < line.length &&
        line.charCodeAt(j + 1) === 0x5c
      ) {
        return j + 2;
      }
      if (line.charCodeAt(j) === 0x07) return j + 1;
      j++;
    }
    return j;
  }
  if (next === 0x28 || next === 0x29 || next === 0x2a || next === 0x2b) {
    // Charset designation: ESC ( char, ESC ) char, etc.
    return i + 3;
  }
  // Other 2-byte ESC sequence
  return i + 2;
}

/**
 * Count the visible (non-escape) characters in a line.
 */
function visibleWidth(line: string): number {
  let count = 0;
  let i = 0;
  while (i < line.length) {
    const next = skipEscapeAt(line, i);
    if (next !== i) {
      i = next;
    } else {
      count++;
      i++;
    }
  }
  return count;
}

/**
 * Calculate the maximum visible character width across all lines in content.
 * Used by the desktop fit-width toggle to determine the required terminal column count.
 */
export function maxContentWidth(content: string): number {
  let max = 0;
  for (const line of content.split("\n")) {
    const w = visibleWidth(line);
    if (w > max) max = w;
  }
  return max;
}

// U+2500 ─ (light horizontal), U+2501 ━ (heavy horizontal), U+2550 ═ (double horizontal)
const BORDER_CHAR_SET = new Set([0x2500, 0x2501, 0x2550]);

/**
 * Check if a line is "border-like": more than half of its
 * non-whitespace visible characters are horizontal box-drawing characters.
 */
function isBorderLike(stripped: string): boolean {
  const trimmed = stripped.trim();
  if (!trimmed) return false;
  let borderCount = 0;
  for (let i = 0; i < trimmed.length; i++) {
    if (BORDER_CHAR_SET.has(trimmed.charCodeAt(i))) borderCount++;
  }
  return borderCount > trimmed.length * 0.5;
}

/**
 * Truncate a line from the LEFT so that the rightmost `maxWidth` visible
 * characters are preserved.  Labels like `@worker-phase2` that appear near
 * the right end of border lines are kept; leading border chars are trimmed.
 *
 * ANSI escape sequences embedded in the kept portion are preserved.
 * Escape sequences before the truncation point are discarded (the kept
 * portion's own sequences provide the correct rendering state).
 */
function truncateAnsiFromLeft(line: string, maxWidth: number): string {
  const total = visibleWidth(line);
  if (total <= maxWidth) return line;

  // Skip (total - maxWidth) visible characters from the front
  const skipCount = total - maxWidth;
  let skipped = 0;
  let i = 0;
  while (i < line.length && skipped < skipCount) {
    const next = skipEscapeAt(line, i);
    if (next !== i) {
      i = next; // skip escape without counting
    } else {
      skipped++;
      i++;
    }
  }

  return line.substring(i);
}

/**
 * Process terminal content for mobile display.
 *
 * When `columns` is provided, border-like lines (lines where >50% of visible
 * characters are horizontal box-drawing chars) are truncated from the LEFT
 * to exactly `columns` visible characters.  This preserves labels like
 * `@worker-phase2` that appear near the right end of border lines, while
 * trimming the leading decorative border characters.
 *
 * When `columns` is omitted, pure border lines are removed entirely (legacy).
 */
export function filterHorizontalBorders(content: string, columns?: number): string {
  const lines = content.split("\n");

  if (columns != null) {
    const processed = lines.map((line) => {
      const stripped = stripAnsi(line);
      if (isBorderLike(stripped)) {
        return truncateAnsiFromLeft(line, columns);
      }
      return line;
    });
    return processed.join("\n");
  }

  // Legacy: remove lines consisting entirely of border characters
  const filtered = lines.filter((line) => {
    const stripped = stripAnsi(line);
    if (!stripped.trim()) return true;
    return !/^[\s\u2500\u2501\u2550]+$/.test(stripped);
  });
  return filtered.join("\n");
}
