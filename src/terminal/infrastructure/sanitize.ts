const ESC = String.fromCharCode(0x1b);

/**
 * Remove text rendered with ANSI SGR code 2 (dim/faint).
 * Matches ESC[2m...content...ESC[22m or ESC[0m or bare ESC[m.
 * Uses String.fromCharCode to build ESC-based patterns,
 * satisfying the noControlCharactersInRegex lint rule.
 */
function stripDimText(input: string): string {
  // ESC[2m starts dim, terminated by ESC[22m, ESC[0m, or ESC[m
  const pattern = new RegExp(`${ESC}\\[2m[\\s\\S]*?${ESC}\\[(22|0)?m`, "g");
  return input.replace(pattern, "");
}

/**
 * Strip all remaining ANSI escape sequences (CSI, OSC, two-byte ESC sequences).
 */
function stripAnsiEscapes(input: string): string {
  // CSI sequences: ESC[ ... final byte (0x40-0x7E)
  const csi = new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, "g");
  // OSC sequences: ESC] ... ST (ESC\\ or BEL)
  const osc = new RegExp(`${ESC}\\][\\s\\S]*?(?:${ESC}\\\\|\\x07)`, "g");
  // Two-byte ESC sequences: ESC followed by a single char (0x40-0x7E)
  const twoByteEsc = new RegExp(`${ESC}[A-Za-z@-~]`, "g");

  return input.replace(csi, "").replace(osc, "").replace(twoByteEsc, "");
}

/**
 * Full sanitization pipeline for pane content before sending to Gemini:
 * 1. Strip dim/faint text (autocomplete suggestions)
 * 2. Strip remaining ANSI escape sequences
 * 3. Collapse double spaces
 */
export function sanitizePaneContent(input: string): string {
  let result = stripDimText(input);
  result = stripAnsiEscapes(result);
  result = result.replace(/ {2,}/g, " ");
  return result;
}
