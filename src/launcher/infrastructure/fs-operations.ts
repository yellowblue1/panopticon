import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_LAUNCHER_CONFIG } from "../application/manage-config";
import type { LauncherDeps } from "../domain/ports";
import type { LauncherConfig } from "../domain/types";

function shellEscape(str: string): string {
  return `'${str.replace(/'/g, "'\\''")}'`;
}

function execCommand(command: string): string {
  const result = Bun.spawnSync(["sh", "-c", command], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 5000,
  });
  if (!result.success) {
    const stderr = result.stderr.toString().trim();
    throw new Error(stderr || `Command failed with exit code ${result.exitCode}`);
  }
  return result.stdout.toString().trim();
}

function isValidLauncherConfig(data: unknown): data is LauncherConfig {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    Array.isArray(obj.scanPaths) &&
    obj.scanPaths.every((p: unknown) => typeof p === "string") &&
    typeof obj.useGhq === "boolean"
  );
}

interface LauncherInfraDeps {
  getProjectName: (cwd: string) => string;
  getGitBranch: (cwd: string) => string | null;
  getGitRemoteUrl: (cwd: string) => string | null;
}

export function createLauncherDeps(infraDeps: LauncherInfraDeps): LauncherDeps {
  const configDir = join(homedir(), ".config", "panopticon");
  const configPath = join(configDir, "launcher.json");

  return {
    readDir: (path) => {
      try {
        return readdirSync(path);
      } catch {
        return [];
      }
    },

    isDirectory: (path) => {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    },

    isGitWorktree: (path) => {
      try {
        const dotGit = join(path, ".git");
        if (!existsSync(dotGit)) return false;
        if (statSync(dotGit).isDirectory()) return false;
        const content = readFileSync(dotGit, "utf-8");
        return content.includes(".git/worktrees/");
      } catch {
        return false;
      }
    },

    pathExists: (path) => existsSync(path),

    resolvePath: (path) => resolve(path.replace(/^~/, homedir())),
    homeDir: () => homedir(),

    getProjectName: infraDeps.getProjectName,
    getGitBranch: infraDeps.getGitBranch,
    getGitRemoteUrl: infraDeps.getGitRemoteUrl,

    getDefaultBranch: (cwd) => {
      try {
        const ref = execCommand(`git -C ${shellEscape(cwd)} symbolic-ref refs/remotes/origin/HEAD`);
        return ref.replace("refs/remotes/origin/", "");
      } catch {
        return null;
      }
    },

    ghqRoot: () => {
      try {
        return execCommand("ghq root");
      } catch {
        return null;
      }
    },

    ghqList: () => {
      try {
        const output = execCommand("ghq list");
        return output.split("\n").filter(Boolean);
      } catch {
        return [];
      }
    },

    tmuxNewSession: (name, cwd) => {
      try {
        const paneId = execCommand(
          `tmux new-session -d -s ${shellEscape(name)} -c ${shellEscape(cwd)} -PF '#{pane_id}'`,
        );
        execCommand("sleep 0.5");
        return paneId;
      } catch {
        return null;
      }
    },

    tmuxNewWindow: (sessionName, cwd) => {
      try {
        const paneId = execCommand(
          `tmux new-window -t ${shellEscape(sessionName)} -c ${shellEscape(cwd)} -PF '#{pane_id}'`,
        );
        execCommand("sleep 0.5");
        return paneId;
      } catch {
        return null;
      }
    },

    tmuxListSessionNames: () => {
      try {
        const output = execCommand("tmux list-sessions -F '#{session_name}'");
        return output.split("\n").filter(Boolean);
      } catch {
        return [];
      }
    },

    tmuxSendKeys: (paneId, text) => {
      const target = shellEscape(paneId);
      const escaped = shellEscape(text);
      execCommand(`printf '%s' ${escaped} | tmux load-buffer -b panopticon-launch -`);
      execCommand(`tmux paste-buffer -b panopticon-launch -t ${target} -d`);
      execCommand(`tmux send-keys -t ${target} Enter`);
    },

    readConfig: () => {
      try {
        if (!existsSync(configPath)) return DEFAULT_LAUNCHER_CONFIG;
        const raw = readFileSync(configPath, "utf-8");
        const parsed: unknown = JSON.parse(raw);
        if (isValidLauncherConfig(parsed)) return parsed;
        return DEFAULT_LAUNCHER_CONFIG;
      } catch {
        return DEFAULT_LAUNCHER_CONFIG;
      }
    },

    writeConfig: (config) => {
      mkdirSync(configDir, { recursive: true });
      writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    },
  };
}
