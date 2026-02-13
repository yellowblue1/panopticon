// Shared types for client/server communication
// These types are used in API requests and responses

export type SessionStatus = "busy" | "waiting";

export type AgentType = "claude" | "codex";

export interface SessionResponse {
  pane_id: string;
  project_name: string;
  git_branch: string | null;
  status: SessionStatus;
  summary: string | null;
  tmux_target: string;
  last_activity: string;
  agent_type: AgentType;
}

export interface SessionsApiResponse {
  sessions: SessionResponse[];
  timestamp: number;
}

export interface AuthStatusResponse {
  gcloud_authenticated: boolean;
  gcp_project_configured: boolean;
  ai_summary_available: boolean;
  /** Runtime Gemini auth error (e.g., expired ADC token) */
  gemini_auth_error: boolean;
}

export interface PaneContentResponse {
  pane_id: string;
  content: string | null;
  timestamp: number;
}

// --- Diff-based SSE message types ---

/** A single changed line in a diff update */
export interface LineDiffEntry {
  /** 0-based line index in the full content */
  index: number;
  /** The new content of the line (including ANSI escapes) */
  content: string;
}

/** Full content message (sent on initial connect and periodic full sync) */
export interface PaneContentFull {
  type: "full";
  pane_id: string;
  content: string | null;
  timestamp: number;
  /** Monotonically increasing sequence number for ordering */
  seq: number;
}

/** Diff message (sent on subsequent updates when content changes) */
export interface PaneContentDiff {
  type: "diff";
  pane_id: string;
  /** Lines that changed, applied to previous full content split by \n */
  lines: LineDiffEntry[];
  /** New total line count after applying diff */
  lineCount: number;
  timestamp: number;
  /** Monotonically increasing sequence number for ordering */
  seq: number;
}

/** Union type for SSE pane content messages */
export type PaneContentMessage = PaneContentFull | PaneContentDiff;

export interface SendKeysResponse {
  success: boolean;
  error?: string;
}

export interface SwitchClientResponse {
  success: boolean;
  error?: string;
}

// Action detection types for dynamic action buttons
export type PaneAction =
  | { type: "choices"; options: { label: string; value: string; autoEnter: boolean }[] }
  | { type: "yesno" }
  | { type: "freeform"; placeholder: string }
  | { type: "none" };

export interface PaneActionsResponse {
  pane_id: string;
  action: PaneAction;
  timestamp: number;
}
