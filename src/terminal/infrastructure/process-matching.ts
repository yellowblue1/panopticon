import type { ClaudeProcess, ProcessInfo, TmuxPane } from "../domain/types";

/**
 * Check if a command string is a Claude CLI binary.
 * Matches only the actual `claude` binary name (case-sensitive),
 * not processes that happen to have "claude" in their arguments or paths.
 */
/** @internal Exported for testing only */
export function isClaudeBinary(command: string): boolean {
  const firstWord = command.split(/\s+/)[0] || "";
  const binaryName = firstWord.split("/").pop() || "";
  return binaryName === "claude";
}

/**
 * Find all Claude Code CLI processes from a process table.
 * Only matches the `claude` binary itself, filtering out Claude Desktop app,
 * editors with .claude/ paths, and other false positives.
 */
export function getClaudeProcesses(processTable: ProcessInfo[]): ClaudeProcess[] {
  return processTable
    .filter((p) => isClaudeBinary(p.command))
    .map((p) => ({ pid: p.pid, ppid: p.ppid }));
}

/**
 * Build tmux target string from pane info
 */
export function buildTmuxTarget(pane: TmuxPane): string {
  return `${pane.session_name}:${pane.window_index}.${pane.pane_index}`;
}

/**
 * Match Claude processes to tmux panes by walking the process tree.
 * For each Claude process, walks up the PPID chain to find an ancestor
 * that is a tmux pane's initial process (pane_pid).
 * This handles cases where claude is launched through intermediate processes
 * (e.g., shell → wrapper script → claude).
 */
export function matchProcessesToPanes(
  processes: ClaudeProcess[],
  panes: TmuxPane[],
  processTable: ProcessInfo[] = [],
): Map<string, { process: ClaudeProcess; pane: TmuxPane }> {
  const paneByPid = new Map<number, TmuxPane>();
  for (const pane of panes) {
    paneByPid.set(pane.pane_pid, pane);
  }

  // Build PID → ProcessInfo lookup for ancestor walking
  const processById = new Map<number, ProcessInfo>();
  for (const p of processTable) {
    processById.set(p.pid, p);
  }

  const result = new Map<string, { process: ClaudeProcess; pane: TmuxPane }>();

  for (const proc of processes) {
    // Walk up the process tree from claude's parent
    let currentPid = proc.ppid;
    const visited = new Set<number>();

    while (currentPid > 1 && !visited.has(currentPid)) {
      visited.add(currentPid);

      const pane = paneByPid.get(currentPid);
      if (pane) {
        result.set(pane.pane_id, { process: proc, pane });
        break;
      }

      const parent = processById.get(currentPid);
      if (!parent) break;
      currentPid = parent.ppid;
    }
  }

  return result;
}
