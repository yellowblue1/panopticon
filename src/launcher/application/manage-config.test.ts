import { describe, expect, it } from "bun:test";
import type { LauncherDeps } from "../domain/ports";
import type { LauncherConfig } from "../domain/types";
import { DEFAULT_LAUNCHER_CONFIG, getLauncherConfig, updateLauncherConfig } from "./manage-config";

function createMockDeps(overrides: Partial<LauncherDeps> = {}): LauncherDeps {
  return {
    readDir: () => [],
    isDirectory: () => true,
    pathExists: () => true,
    resolvePath: (p) => p,
    homeDir: () => "/home/test",
    getProjectName: (cwd) => cwd.split("/").pop() ?? "unknown",
    getGitBranch: () => null,
    getGitRemoteUrl: () => null,
    ghqRoot: () => null,
    ghqList: () => [],
    tmuxNewSession: () => null,
    tmuxNewWindow: () => null,
    tmuxListSessionNames: () => [],
    tmuxSendKeys: () => {},
    readConfig: () => DEFAULT_LAUNCHER_CONFIG,
    writeConfig: () => {},
    ...overrides,
  };
}

describe("DEFAULT_LAUNCHER_CONFIG", () => {
  it("has empty scan paths", () => {
    expect(DEFAULT_LAUNCHER_CONFIG.scanPaths).toEqual([]);
  });

  it("has ghq enabled by default", () => {
    expect(DEFAULT_LAUNCHER_CONFIG.useGhq).toBe(true);
  });
});

describe("getLauncherConfig", () => {
  it("returns config from deps", () => {
    const config: LauncherConfig = {
      scanPaths: ["/home/test/src"],
      useGhq: false,
    };
    const deps = createMockDeps({ readConfig: () => config });

    expect(getLauncherConfig(deps)).toEqual(config);
  });

  it("returns default config when deps returns default", () => {
    const deps = createMockDeps();
    expect(getLauncherConfig(deps)).toEqual(DEFAULT_LAUNCHER_CONFIG);
  });
});

describe("updateLauncherConfig", () => {
  it("writes config via deps and returns it", () => {
    let writtenConfig: LauncherConfig | undefined;
    const deps = createMockDeps({
      writeConfig: (config) => {
        writtenConfig = config;
      },
    });

    const newConfig: LauncherConfig = {
      scanPaths: ["/home/test/projects"],
      useGhq: true,
    };

    const result = updateLauncherConfig(newConfig, deps);

    expect(result).toEqual(newConfig);
    expect(writtenConfig).toEqual(newConfig);
  });
});
