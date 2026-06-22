// Shared types for client/server communication
// These types are used in API requests and responses

// Single source of truth for monitored agent CLIs. Used both as the runtime
// allowlist (process discovery, server-side launch validation) and as the
// compile-time AgentType union — keeping them in sync makes drift a type
// error rather than a silent "unknown" fallback in the UI.
export const AGENT_TYPES = ["claude", "codex", "nori"] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

export function isAgentType(value: string): value is AgentType {
  return (AGENT_TYPES as readonly string[]).includes(value);
}

// Nori has no dialect entry because it wraps either backend; UIs that need
// to support nori fetch both dialects' commands and accept both prefixes.
const AGENT_DIALECTS = ["claude", "codex"] as const;
export type AgentDialect = (typeof AGENT_DIALECTS)[number];

export function isAgentDialect(value: string): value is AgentDialect {
  return (AGENT_DIALECTS as readonly string[]).includes(value);
}

export interface SessionResponse {
  pane_id: string;
  project_name: string;
  window_name: string;
  github_repo_url: string | null;
  status: "busy" | "waiting";
  summary: string | null;
  tmux_target: string;
  tmux_session_name: string;
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

export interface InterruptResponse {
  success: boolean;
  error?: string;
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

export interface BrowseEntry {
  name: string;
  path: string;
}

export interface BrowsePathResponse {
  entries: BrowseEntry[];
  basePath: string;
  timestamp: number;
}

// Send message (text + file upload) types
export interface SendMessageResponse {
  success: boolean;
  error?: string;
  uploadedFiles?: Array<{ originalName: string }>;
}

// MCP file push types
export interface FilePushSseEvent {
  readonly type: "file_push";
  readonly filename: string;
  readonly mimeType: string;
  readonly size: number;
  readonly sessionId: string;
  readonly timestamp: number;
  readonly base64: string;
}

// MCP URL push types
export interface UrlPushSseEvent {
  readonly type: "url_push";
  readonly url: string;
  readonly label: string | null;
  readonly sessionId: string;
  readonly timestamp: number;
}
