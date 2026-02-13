import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Save original env values
const originalEnv = {
  PANOPTICON_CACHE_DIR: process.env.PANOPTICON_CACHE_DIR,
  XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
};

describe("cache-dir", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "panopticon-cachedir-test-"));
    // Clear env vars before each test
    delete process.env.PANOPTICON_CACHE_DIR;
    delete process.env.XDG_CACHE_HOME;
  });

  afterEach(() => {
    // Restore original env values
    if (originalEnv.PANOPTICON_CACHE_DIR !== undefined) {
      process.env.PANOPTICON_CACHE_DIR = originalEnv.PANOPTICON_CACHE_DIR;
    } else {
      delete process.env.PANOPTICON_CACHE_DIR;
    }
    if (originalEnv.XDG_CACHE_HOME !== undefined) {
      process.env.XDG_CACHE_HOME = originalEnv.XDG_CACHE_HOME;
    } else {
      delete process.env.XDG_CACHE_HOME;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  // Re-import the module to pick up env changes
  async function importGetCacheDir() {
    // Use dynamic import with cache busting to get fresh module evaluation
    // Note: Bun caches module imports, so we test the function behavior
    // with env vars set before calling it.
    const { getCacheDir } = await import("./cache-dir");
    return getCacheDir;
  }

  it("uses PANOPTICON_CACHE_DIR when set", async () => {
    const customDir = join(tempDir, "custom-cache");
    process.env.PANOPTICON_CACHE_DIR = customDir;

    const getCacheDir = await importGetCacheDir();
    const result = getCacheDir();

    expect(result).toBe(customDir);
    expect(existsSync(customDir)).toBe(true);
  });

  it("uses XDG_CACHE_HOME when set", async () => {
    const xdgDir = join(tempDir, "xdg-cache");
    process.env.XDG_CACHE_HOME = xdgDir;

    const getCacheDir = await importGetCacheDir();
    const result = getCacheDir();

    expect(result).toBe(join(xdgDir, "panopticon"));
    expect(existsSync(join(xdgDir, "panopticon"))).toBe(true);
  });

  it("PANOPTICON_CACHE_DIR takes precedence over XDG_CACHE_HOME", async () => {
    const customDir = join(tempDir, "custom");
    const xdgDir = join(tempDir, "xdg");
    process.env.PANOPTICON_CACHE_DIR = customDir;
    process.env.XDG_CACHE_HOME = xdgDir;

    const getCacheDir = await importGetCacheDir();
    const result = getCacheDir();

    expect(result).toBe(customDir);
  });

  it("creates directory if it does not exist", async () => {
    const nestedDir = join(tempDir, "deep", "nested", "cache");
    process.env.PANOPTICON_CACHE_DIR = nestedDir;

    const getCacheDir = await importGetCacheDir();
    getCacheDir();

    expect(existsSync(nestedDir)).toBe(true);
  });

  it("defaults to ~/.cache/panopticon when no env vars set", async () => {
    const getCacheDir = await importGetCacheDir();
    const result = getCacheDir();

    // Should end with .cache/panopticon (under home directory)
    expect(result).toEndWith(join(".cache", "panopticon"));
  });
});
