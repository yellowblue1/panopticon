import { join } from "node:path";
import type { PlanDiscoveryDeps } from "../domain/ports";
import type { PlanInfo } from "../domain/types";

/**
 * Escape a cwd path to the format used by Claude Code for project directories.
 * Replaces `/` and `.` with `-`.
 * e.g. "/Users/foo/github.com/bar" → "-Users-foo-github-com-bar"
 */
export function escapeCwd(cwd: string): string {
  return cwd.replaceAll("/", "-").replaceAll(".", "-");
}

/**
 * Find the slug for a given cwd by reading the latest JSONL session log.
 * Returns the slug string or null if not found.
 */
export function findSlugForCwd(cwd: string, deps: PlanDiscoveryDeps): string | null {
  const escapedCwd = escapeCwd(cwd);
  const projectsDir = join(deps.homeDir(), ".claude", "projects", escapedCwd);

  if (!deps.fileExists(projectsDir)) return null;

  const files = deps.listDir(projectsDir);
  const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

  if (jsonlFiles.length === 0) return null;

  // Sort by modification time, newest first
  const sorted = jsonlFiles
    .map((f) => ({ name: f, mtime: deps.getFileMtime(join(projectsDir, f)) }))
    .sort((a, b) => b.mtime - a.mtime);

  // Try each JSONL file (newest first) until we find a slug
  for (const file of sorted) {
    const content = deps.readFileText(join(projectsDir, file.name));
    if (!content) continue;

    // Read line by line looking for a slug field
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (typeof entry.slug === "string" && entry.slug.length > 0) {
          return entry.slug;
        }
      } catch {
        // Skip malformed lines
      }
    }
  }

  return null;
}

/**
 * Read the plan file content for a given slug.
 * Returns the markdown content or null if the file doesn't exist.
 */
export function readPlanContent(slug: string, deps: PlanDiscoveryDeps): string | null {
  const planPath = join(deps.homeDir(), ".claude", "plans", `${slug}.md`);
  return deps.readFileText(planPath);
}

/**
 * Discover a plan for the given cwd.
 * Orchestrates the full chain: cwd → escaped path → latest JSONL → slug → plan file.
 */
export function discoverPlan(cwd: string, deps: PlanDiscoveryDeps): PlanInfo | null {
  const slug = findSlugForCwd(cwd, deps);
  if (!slug) return null;

  const content = readPlanContent(slug, deps);
  if (!content) return null;

  return { slug, content };
}

/**
 * Check if a plan file exists for the given slug.
 */
export function planFileExists(slug: string, deps: PlanDiscoveryDeps): boolean {
  const planPath = join(deps.homeDir(), ".claude", "plans", `${slug}.md`);
  return deps.fileExists(planPath);
}
