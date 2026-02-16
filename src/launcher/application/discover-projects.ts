import type { LauncherDeps } from "../domain/ports";
import type { Project } from "../domain/types";

export function discoverProjects(deps: LauncherDeps): Project[] {
  const config = deps.readConfig();
  const projects = new Map<string, Project>();

  for (const basePath of config.scanPaths) {
    const resolved = deps.resolvePath(basePath);
    if (!deps.pathExists(resolved) || !deps.isDirectory(resolved)) continue;

    const entries = deps.readDir(resolved);
    for (const entry of entries) {
      const fullPath = `${resolved}/${entry}`;
      if (projects.has(fullPath)) continue;
      if (!deps.isDirectory(fullPath)) continue;

      projects.set(fullPath, {
        name: deps.getProjectName(fullPath),
        path: fullPath,
        gitBranch: deps.getGitBranch(fullPath),
        gitRemoteUrl: deps.getGitRemoteUrl(fullPath),
      });
    }
  }

  if (config.useGhq) {
    const ghqRootPath = deps.ghqRoot();
    if (ghqRootPath) {
      const ghqProjects = deps.ghqList();
      for (const relPath of ghqProjects) {
        const fullPath = `${ghqRootPath}/${relPath}`;
        if (projects.has(fullPath)) continue;

        projects.set(fullPath, {
          name: deps.getProjectName(fullPath),
          path: fullPath,
          gitBranch: deps.getGitBranch(fullPath),
          gitRemoteUrl: deps.getGitRemoteUrl(fullPath),
        });
      }
    }
  }

  return Array.from(projects.values()).sort((a, b) => a.name.localeCompare(b.name));
}
