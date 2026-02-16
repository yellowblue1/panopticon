import type { LauncherConfig } from "./types";

export interface LauncherDeps {
  // Filesystem
  readDir: (path: string) => string[];
  isDirectory: (path: string) => boolean;
  pathExists: (path: string) => boolean;
  resolvePath: (path: string) => string;

  // Git info (injected from terminal context via composition root)
  getProjectName: (cwd: string) => string;
  getGitBranch: (cwd: string) => string | null;
  getGitRemoteUrl: (cwd: string) => string | null;
  getDefaultBranch: (cwd: string) => string | null;

  // ghq (graceful when not installed)
  ghqRoot: () => string | null;
  ghqList: () => string[];

  // tmux operations
  tmuxNewSession: (name: string, cwd: string) => string | null;
  tmuxNewWindow: (sessionName: string, cwd: string) => string | null;
  tmuxListSessionNames: () => string[];
  tmuxSendKeys: (paneId: string, text: string) => void;

  // Config persistence
  readConfig: () => LauncherConfig;
  writeConfig: (config: LauncherConfig) => void;
}
