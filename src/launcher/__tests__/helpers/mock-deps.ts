import { DEFAULT_LAUNCHER_CONFIG } from "../../application/manage-config";
import type { LauncherDeps } from "../../domain/ports";

export function createMockLauncherDeps(overrides: Partial<LauncherDeps> = {}): LauncherDeps {
  return {
    readDir: () => [],
    isDirectory: () => true,
    pathExists: () => true,
    resolvePath: (p) => p.replace("~", "/home/test"),
    getProjectName: (cwd) => cwd.split("/").pop() ?? "unknown",
    getGitBranch: () => null,
    getGitRemoteUrl: () => null,
    getDefaultBranch: () => null,
    ghqRoot: () => null,
    ghqList: () => [],
    tmuxNewSession: () => "%0",
    tmuxNewWindow: () => "%1",
    tmuxListSessionNames: () => [],
    tmuxSendKeys: () => {},
    readConfig: () => DEFAULT_LAUNCHER_CONFIG,
    writeConfig: () => {},
    ...overrides,
  };
}
