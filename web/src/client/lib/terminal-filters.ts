const ESC = String.fromCharCode(0x1b);

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

// Matches lines consisting entirely of horizontal box-drawing characters and whitespace.
// U+2500 ─ (light horizontal), U+2501 ━ (heavy horizontal), U+2550 ═ (double horizontal)
const HORIZONTAL_BORDER_RE = /^[\s\u2500\u2501\u2550]+$/;

/**
 * Filter out lines consisting entirely of horizontal box-drawing characters.
 * Used on mobile to save vertical space by removing Claude Code's prompt borders.
 */
export function filterHorizontalBorders(content: string): string {
  const lines = content.split("\n");
  const filtered = lines.filter((line) => {
    const stripped = stripAnsi(line);
    if (!stripped.trim()) return true;
    return !HORIZONTAL_BORDER_RE.test(stripped);
  });
  return filtered.join("\n");
}
