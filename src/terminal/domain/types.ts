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

export interface MonitoredProcess {
  pid: number;
  ppid: number;
  binaryName: string;
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
