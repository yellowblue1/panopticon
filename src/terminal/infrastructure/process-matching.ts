import { AGENT_TYPES } from "../../shared/types";
import type { MonitoredProcess, ProcessInfo, TmuxPane } from "../domain/types";

const MONITORED_BINARIES = new Set<string>(AGENT_TYPES);

// Agent Teams workers exec the versioned bundle directly
// (`~/.local/share/claude/versions/<X> --agent-id ... --team-name ...`),
// so argv[0]'s last path component is a version string, not "claude". A naive
// `split(/\s+/)[0]` truncates macOS home dirs containing spaces (`~/Library/
// Application Support/claude/versions/<X>`), and an unanchored regex over the
// full command mis-classifies things like `/usr/bin/vim /any/path/claude/
// versions/X`. Find every `/claude/versions/<X>` suffix and accept only when
// its prefix looks like argv[0]: starts with `/` and contains no ` /` (which
// would mean the prefix already crossed into argv[1]).
const CLAUDE_VERSIONED_SUFFIX = /\/claude\/versions\/[^/\s]+(?=\s|$)/g;

function isClaudeVersionedArgv0(command: string): boolean {
  for (const match of command.matchAll(CLAUDE_VERSIONED_SUFFIX)) {
    const prefix = command.slice(0, match.index);
    if (prefix.startsWith("/") && !prefix.includes(" /")) return true;
  }
  return false;
}

function extractBinaryName(command: string): string {
  if (isClaudeVersionedArgv0(command)) return "claude";
  const firstWord = command.split(/\s+/)[0] || "";
  return firstWord.split("/").pop() || "";
}

/**
 * Check if a command string is a monitored coding-agent binary.
 * Matches the actual binary name (case-sensitive) for any entry in MONITORED_BINARIES,
 * not processes that happen to have the name in their arguments or paths.
 */
/** @internal Exported for testing only */
export function isMonitoredBinary(command: string): boolean {
  return MONITORED_BINARIES.has(extractBinaryName(command));
}

/**
 * Find all monitored coding-agent CLI processes from a process table.
 * Only matches the actual binary itself, filtering out desktop apps,
 * editors with config paths, and other false positives.
 */
export function getMonitoredProcesses(processTable: ProcessInfo[]): MonitoredProcess[] {
  return processTable
    .filter((p) => isMonitoredBinary(p.command))
    .map((p) => ({ pid: p.pid, ppid: p.ppid, binaryName: extractBinaryName(p.command) }));
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
 *
 * The walk starts from the agent process itself, not its parent: when tmux is
 * launched with the agent as the pane's initial command (e.g. `tmux new-session
 * -d 'claude'`, common in cron-driven bootstrap scripts), pane_pid IS the
 * agent's pid, so a parent-only walk would never match.
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
    // Start at the agent process itself to cover the case where pane_pid is
    // the agent (cron-launched `tmux new-session -d claude`), then fall back
    // to its known ppid so the walk continues even when processTable is empty.
    const selfPane = paneByPid.get(proc.pid);
    if (selfPane) {
      result.set(selfPane.pane_id, { process: proc, pane: selfPane });
      continue;
    }

    let currentPid = proc.ppid;
    const visited = new Set<number>([proc.pid]);

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
