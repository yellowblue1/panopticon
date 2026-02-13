/**
 * Cache directory resolution for persistent Gemini API response cache.
 *
 * Location strategy (XDG Base Directory Specification for all platforms):
 * - PANOPTICON_CACHE_DIR env override (highest priority)
 * - $XDG_CACHE_HOME/panopticon/ (default: ~/.cache/panopticon/)
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function ensureDir(dir: string): string {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getCacheDir(): string {
  const envDir = process.env.PANOPTICON_CACHE_DIR;
  if (envDir) {
    return ensureDir(envDir);
  }

  const xdgCache = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
  return ensureDir(join(xdgCache, "panopticon"));
}
