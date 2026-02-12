// Internal types for tmux polling

export interface SessionState {
  pane_id: string;
  process_pid: number;
  cwd: string;
  project_name: string;
  git_branch: string | null;
  status: "busy" | "waiting";
  summary: string | null;
  tmux_target: string;
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
}

export interface MonitoredProcess {
  pid: number;
  ppid: number;
}

export interface ProcessInfo {
  pid: number;
  ppid: number;
  command: string;
}
