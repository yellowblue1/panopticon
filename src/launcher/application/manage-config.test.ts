import { describe, expect, it } from "bun:test";
import { createMockLauncherDeps } from "../__tests__";
import type { LauncherConfig } from "../domain/types";
import { DEFAULT_LAUNCHER_CONFIG, getLauncherConfig, updateLauncherConfig } from "./manage-config";

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
    const deps = createMockLauncherDeps({ readConfig: () => config });

    expect(getLauncherConfig(deps)).toEqual(config);
  });

  it("returns default config when deps returns default", () => {
    const deps = createMockLauncherDeps();
    expect(getLauncherConfig(deps)).toEqual(DEFAULT_LAUNCHER_CONFIG);
  });
});

describe("updateLauncherConfig", () => {
  it("writes config via deps and returns it", () => {
    let writtenConfig: LauncherConfig | undefined;
    const deps = createMockLauncherDeps({
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
