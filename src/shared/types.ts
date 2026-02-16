// Shared types for client/server communication
// These types are used in API requests and responses

export type SessionStatus = "busy" | "waiting";

export type AgentType = "claude" | "codex";

export interface SessionResponse {
  pane_id: string;
  project_name: string;
  git_branch: string | null;
  github_repo_url: string | null;
  status: SessionStatus;
  summary: string | null;
  tmux_target: string;
  last_activity: string;
  agent_type: AgentType;
  cwd: string;
}

export interface SessionsApiResponse {
  sessions: SessionResponse[];
  timestamp: number;
}

export type GeminiBackend = "google-ai" | "vertex-ai";

export interface AuthStatusResponse {
  ai_summary_available: boolean;
  /** Runtime Gemini auth error (e.g., expired ADC token or invalid API key) */
  gemini_auth_error: boolean;
  /** Which Gemini backend is active, or null when unconfigured */
  gemini_backend: GeminiBackend | null;
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

// Plan viewer types
export interface PlanResponse {
  pane_id: string;
  plan: { slug: string; content: string } | null;
  timestamp: number;
}

export interface PlansAvailabilityResponse {
  plans: Record<string, boolean>;
  timestamp: number;
}

export interface DeletePlanResponse {
  success: boolean;
  error?: string;
}

// Slash command configuration types
export interface SlashCommand {
  command: string;
  description: string;
}

export interface SlashCommandsResponse {
  commands: SlashCommand[];
  timestamp: number;
}

// Launcher types
export interface ProjectResponse {
  name: string;
  path: string;
  gitBranch: string | null;
  gitRemoteUrl: string | null;
}

export interface ProjectsApiResponse {
  projects: ProjectResponse[];
  timestamp: number;
}

export interface LaunchResponse {
  success: boolean;
  sessionName: string;
  paneId: string | null;
  error?: string;
}

export interface LauncherConfigData {
  scanPaths: string[];
  useGhq: boolean;
}

export interface LauncherConfigResponse {
  config: LauncherConfigData;
  timestamp: number;
}
