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
 * Truncate a string with ANSI escapes to a maximum visible width.
 * ANSI escape sequences are skipped (zero width) and preserved in output.
 */
function truncateAnsiToWidth(line: string, maxWidth: number): string {
  let visible = 0;
  let i = 0;

  while (i < line.length && visible < maxWidth) {
    if (line.charCodeAt(i) === ESC_CODE && i + 1 < line.length) {
      const next = line.charCodeAt(i + 1);
      if (next === 0x5b) {
        // CSI: ESC[ params final-byte (0x40-0x7e)
        let j = i + 2;
        while (j < line.length && line.charCodeAt(j) < 0x40) j++;
        i = j < line.length ? j + 1 : j;
      } else if (next === 0x5d) {
        // OSC: ESC] ... (ESC\ or BEL)
        let j = i + 2;
        while (j < line.length) {
          if (
            line.charCodeAt(j) === ESC_CODE &&
            j + 1 < line.length &&
            line.charCodeAt(j + 1) === 0x5c
          ) {
            j += 2;
            break;
          }
          if (line.charCodeAt(j) === 0x07) {
            j++;
            break;
          }
          j++;
        }
        i = j;
      } else if (next === 0x28 || next === 0x29 || next === 0x2a || next === 0x2b) {
        // Charset designation: ESC ( char, ESC ) char, etc.
        i += 3;
      } else {
        // Other 2-byte ESC sequence
        i += 2;
      }
    } else {
      visible++;
      i++;
    }
  }

  return line.substring(0, i);
}

/**
 * Process terminal content for mobile display.
 *
 * When `columns` is provided, border-like lines (lines where >50% of visible
 * characters are horizontal box-drawing chars) are truncated to exactly
 * `columns` visible characters.  This gives a clean edge-to-edge appearance
 * on narrow screens without removing the visual separator entirely.
 *
 * When `columns` is omitted, pure border lines are removed entirely (legacy).
 */
export function filterHorizontalBorders(content: string, columns?: number): string {
  const lines = content.split("\n");

  if (columns != null) {
    const processed = lines.map((line) => {
      const stripped = stripAnsi(line);
      if (isBorderLike(stripped)) {
        return truncateAnsiToWidth(line, columns);
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
