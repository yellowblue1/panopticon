import type { LineDiffEntry } from "./types";

/**
 * Compute line-based diff between previous and current content.
 * Returns null if content is identical (caller should skip sending).
 *
 * Lines are compared by strict equality (preserving ANSI escape codes).
 */
export function computeLineDiff(
  prevContent: string,
  currContent: string,
): { lines: LineDiffEntry[]; lineCount: number } | null {
  const prevLines = prevContent.split("\n");
  const currLines = currContent.split("\n");

  const changes: LineDiffEntry[] = [];
  const maxLen = Math.max(prevLines.length, currLines.length);

  for (let i = 0; i < maxLen; i++) {
    const prevLine = i < prevLines.length ? prevLines[i] : undefined;
    const currLine = i < currLines.length ? currLines[i] : undefined;

    if (prevLine !== currLine && currLine !== undefined) {
      changes.push({ index: i, content: currLine });
    }
  }

  if (changes.length === 0 && prevLines.length === currLines.length) {
    return null;
  }

  return { lines: changes, lineCount: currLines.length };
}

/**
 * Apply a line diff to previous content to reconstruct current content.
 * Used by the frontend to reconstruct full terminal content from previous state + diff.
 */
export function applyLineDiff(
  prevContent: string,
  diff: { lines: LineDiffEntry[]; lineCount: number },
): string {
  const prevLines = prevContent.split("\n");

  // Start with previous lines, extended or truncated to new line count
  const result: string[] = [];
  for (let i = 0; i < diff.lineCount; i++) {
    result.push(i < prevLines.length ? prevLines[i] : "");
  }

  // Apply changes
  for (const change of diff.lines) {
    if (change.index < diff.lineCount) {
      result[change.index] = change.content;
    }
  }

  return result.join("\n");
}

/**
 * Estimate whether sending a diff is more efficient than sending full content.
 * Returns true if diff payload is estimated to be smaller.
 */
export function isDiffWorthSending(fullContentLength: number, diffLines: LineDiffEntry[]): boolean {
  // Estimate diff payload size (rough: JSON overhead per entry ~30 chars + content)
  const diffSize = diffLines.reduce((sum, entry) => sum + entry.content.length + 30, 50);
  // Send diff only if it saves at least 30% over full content
  return diffSize < fullContentLength * 0.7;
}
