import type { MonitoredProcess, ProcessInfo, TmuxPane } from "../domain/types";

const MONITORED_BINARIES = new Set(["claude", "codex"]);

/**
 * Check if a command string is a monitored coding-agent binary.
 * Matches the actual binary name (case-sensitive) for any entry in MONITORED_BINARIES,
 * not processes that happen to have the name in their arguments or paths.
 */
/** @internal Exported for testing only */
export function isMonitoredBinary(command: string): boolean {
  const firstWord = command.split(/\s+/)[0] || "";
  const binaryName = firstWord.split("/").pop() || "";
  return MONITORED_BINARIES.has(binaryName);
}

/**
 * Find all monitored coding-agent CLI processes from a process table.
 * Only matches the actual binary itself, filtering out desktop apps,
 * editors with config paths, and other false positives.
 */
export function getMonitoredProcesses(processTable: ProcessInfo[]): MonitoredProcess[] {
  return processTable
    .filter((p) => isMonitoredBinary(p.command))
    .map((p) => ({ pid: p.pid, ppid: p.ppid }));
}

/**
 * Build tmux target string from pane info
 */
export function buildTmuxTarget(pane: TmuxPane): string {
  return `${pane.session_name}:${pane.window_index}.${pane.pane_index}`;
}

/**
 * Match monitored processes to tmux panes by walking the process tree.
 * For each monitored process, walks up the PPID chain to find an ancestor
 * that is a tmux pane's initial process (pane_pid).
 * This handles cases where the agent is launched through intermediate processes
 * (e.g., shell → wrapper script → claude/codex).
 */
export function matchProcessesToPanes(
  processes: MonitoredProcess[],
  panes: TmuxPane[],
  processTable: ProcessInfo[] = [],
): Map<string, { process: MonitoredProcess; pane: TmuxPane }> {
  const paneByPid = new Map<number, TmuxPane>();
  for (const pane of panes) {
    paneByPid.set(pane.pane_pid, pane);
  }

  // Build PID → ProcessInfo lookup for ancestor walking
  const processById = new Map<number, ProcessInfo>();
  for (const p of processTable) {
    processById.set(p.pid, p);
  }

  const result = new Map<string, { process: MonitoredProcess; pane: TmuxPane }>();

  for (const proc of processes) {
    // Walk up the process tree from the agent's parent
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
