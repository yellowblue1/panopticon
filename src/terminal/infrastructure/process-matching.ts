import type { MonitoredBinary, MonitoredProcess, ProcessInfo, TmuxPane } from "../domain/types";
import { MONITORED_BINARY_AGENT_TYPES } from "../domain/types";

/**
 * Extract the binary name from a command string.
 * Takes the last path component of the first whitespace-delimited word.
 */
function extractBinaryName(command: string): string {
  const firstWord = command.split(/\s+/)[0] || "";
  return firstWord.split("/").pop() || "";
}

function isMonitoredBinaryName(name: string): name is MonitoredBinary {
  return Object.hasOwn(MONITORED_BINARY_AGENT_TYPES, name);
}

/**
 * Check if a command string is a monitored coding-agent binary.
 * Matches the actual binary name (case-sensitive), not processes that
 * happen to have the name in their arguments or paths.
 */
/** @internal Exported for testing only */
export function isMonitoredBinary(command: string): boolean {
  return isMonitoredBinaryName(extractBinaryName(command));
}

/**
 * Find all monitored coding-agent CLI processes from a process table.
 * Only matches the actual binary itself, filtering out desktop apps,
 * editors with config paths, and other false positives.
 */
export function getMonitoredProcesses(processTable: ProcessInfo[]): MonitoredProcess[] {
  const result: MonitoredProcess[] = [];
  for (const p of processTable) {
    const binaryName = extractBinaryName(p.command);
    if (!isMonitoredBinaryName(binaryName)) continue;
    result.push({ pid: p.pid, ppid: p.ppid, binaryName, tty: p.tty });
  }
  return result;
}

/**
 * Build tmux target string from pane info
 */
export function buildTmuxTarget(pane: TmuxPane): string {
  return `${pane.session_name}:${pane.window_index}.${pane.pane_index}`;
}

/**
 * Strip the "/dev/" prefix so tmux pane_tty ("/dev/pts/12") and
 * ps tty ("pts/12") values compare equal.
 */
function normalizeTty(tty: string): string {
  return tty.startsWith("/dev/") ? tty.slice("/dev/".length) : tty;
}

/**
 * Match monitored processes to tmux panes by walking the process tree.
 * For each monitored process, walks up the PPID chain to find an ancestor
 * that is a tmux pane's initial process (pane_pid).
 * This handles cases where the agent is launched through intermediate processes
 * (e.g., shell → wrapper script → claude/codex).
 *
 * Processes the walk cannot place (reparented to init after their launcher
 * exited, e.g. codex-acp spawned via bunx) fall back to controlling-tty
 * matching: the tty is inherited from the pane's pty and survives reparenting.
 */
export function matchProcessesToPanes(
  processes: MonitoredProcess[],
  panes: TmuxPane[],
  processTable: ProcessInfo[] = [],
): Map<string, { process: MonitoredProcess; pane: TmuxPane }> {
  const paneByPid = new Map<number, TmuxPane>();
  const paneByTty = new Map<string, TmuxPane>();
  for (const pane of panes) {
    paneByPid.set(pane.pane_pid, pane);
    paneByTty.set(normalizeTty(pane.pane_tty), pane);
  }

  // Build PID → ProcessInfo lookup for ancestor walking
  const processById = new Map<number, ProcessInfo>();
  for (const p of processTable) {
    processById.set(p.pid, p);
  }

  const result = new Map<string, { process: MonitoredProcess; pane: TmuxPane }>();
  const unmatched: MonitoredProcess[] = [];

  for (const proc of processes) {
    // Walk up the process tree from the agent's parent
    let currentPid = proc.ppid;
    const visited = new Set<number>();
    let matched = false;

    while (currentPid > 1 && !visited.has(currentPid)) {
      visited.add(currentPid);

      const pane = paneByPid.get(currentPid);
      if (pane) {
        result.set(pane.pane_id, { process: proc, pane });
        matched = true;
        break;
      }

      const parent = processById.get(currentPid);
      if (!parent) break;
      currentPid = parent.ppid;
    }

    if (!matched) unmatched.push(proc);
  }

  // Tty fallback for orphaned processes. Ancestor-walk matches take
  // precedence — never overwrite a pane that is already claimed.
  for (const proc of unmatched) {
    if (proc.tty === undefined) continue;
    const pane = paneByTty.get(normalizeTty(proc.tty));
    if (pane && !result.has(pane.pane_id)) {
      result.set(pane.pane_id, { process: proc, pane });
    }
  }

  return result;
}
