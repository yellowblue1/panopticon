import type { BrowseEntry } from "../../shared/types";
import type { LauncherDeps } from "../domain/ports";

interface BrowseResult {
  readonly entries: BrowseEntry[];
  readonly basePath: string;
}

export function browsePath(inputPath: string, deps: LauncherDeps): BrowseResult {
  if (inputPath.length === 0) {
    return { entries: [], basePath: "" };
  }

  let browseDir: string;
  let filterPrefix: string;

  if (inputPath === "~") {
    browseDir = "~";
    filterPrefix = "";
  } else if (inputPath.endsWith("/")) {
    browseDir = inputPath;
    filterPrefix = "";
  } else {
    const lastSlash = inputPath.lastIndexOf("/");
    if (lastSlash === -1) {
      return { entries: [], basePath: "" };
    }
    browseDir = inputPath.slice(0, lastSlash + 1);
    filterPrefix = inputPath.slice(lastSlash + 1);
  }

  const raw = deps.resolvePath(browseDir);
  const resolvedDir = raw.length > 1 ? raw.replace(/\/+$/, "") : raw;

  if (!deps.pathExists(resolvedDir) || !deps.isDirectory(resolvedDir)) {
    return { entries: [], basePath: resolvedDir };
  }

  const rawEntries = deps.readDir(resolvedDir);
  const lowerFilter = filterPrefix.toLowerCase();
  const prefix = resolvedDir === "/" ? "/" : `${resolvedDir}/`;

  const entries: BrowseEntry[] = rawEntries
    .filter((name) => {
      if (name.startsWith(".")) return false;
      if (lowerFilter && !name.toLowerCase().startsWith(lowerFilter)) return false;
      return deps.isDirectory(`${prefix}${name}`);
    })
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      name,
      path: `${prefix}${name}`,
    }));

  return { entries, basePath: resolvedDir };
}
