// Internal types for tmux polling

import type { AgentType } from "../../shared/types";

export interface SessionState {
  pane_id: string;
  process_pid: number;
  agent_type: AgentType;
  cwd: string;
  project_name: string;
  git_branch: string | null;
  github_repo_url: string | null;
  status: "busy" | "waiting";
  summary: string | null;
  tmux_target: string;
  tmux_session_name: string;
  last_activity: string;
  previousPaneContent: string | null;
  summary_pending: boolean;
  pipePaneActive: boolean;
  summaryContentHash: number | null;
}

export interface TmuxPane {
  pane_id: string;
  pane_pid: number;
  session_name: string;
  window_index: number;
  pane_index: number;
  /** Pane terminal device as reported by tmux (e.g. "/dev/pts/12") */
  pane_tty: string;
}

/**
 * Single source of truth for which agent binaries are monitored and how
 * each surfaces in the dashboard. Process discovery filters on the keys;
 * session creation reads the agent type from the values.
 */
export const MONITORED_BINARY_AGENT_TYPES = {
  claude: "claude",
  codex: "codex",
  // ACP adapter binary wrapping Codex (spawned via bunx by crux-acp workers)
  "codex-acp": "codex",
} as const satisfies Record<string, AgentType>;

export type MonitoredBinary = keyof typeof MONITORED_BINARY_AGENT_TYPES;

export interface MonitoredProcess {
  pid: number;
  ppid: number;
  binaryName: MonitoredBinary;
  /** Controlling terminal (e.g. "pts/12"); absent when the process has none */
  tty?: string;
}

export interface ProcessInfo {
  pid: number;
  ppid: number;
  command: string;
  /** Controlling terminal (e.g. "pts/12"); absent when the process has none */
  tty?: string;
}
