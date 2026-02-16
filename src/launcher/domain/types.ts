import type { AgentType } from "../../shared/types";

export interface Project {
  readonly name: string;
  readonly path: string;
  readonly gitBranch: string | null;
  readonly gitRemoteUrl: string | null;
}

export interface LaunchConfig {
  readonly projectPath: string;
  readonly agentType: AgentType;
  readonly sessionName: string;
}

export interface LaunchResult {
  readonly success: boolean;
  readonly sessionName: string;
  readonly paneId: string | null;
  readonly error?: string;
}

export interface LauncherConfig {
  readonly scanPaths: string[];
  readonly useGhq: boolean;
}
