import type { LauncherDeps } from "../domain/ports";
import type { LauncherConfig } from "../domain/types";

export const DEFAULT_LAUNCHER_CONFIG: LauncherConfig = {
  scanPaths: [],
  useGhq: true,
};

export function getLauncherConfig(deps: LauncherDeps): LauncherConfig {
  return deps.readConfig();
}

export function updateLauncherConfig(config: LauncherConfig, deps: LauncherDeps): LauncherConfig {
  deps.writeConfig(config);
  return config;
}
