import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SETTINGS_FILE = join(homedir(), ".claude", "panopticon.local.md");

interface ConfigOptions {
  envVar: string;
  settingsKey: string;
  gcloudCmd?: string;
  defaultValue?: string;
}

function getConfigValue(options: ConfigOptions): string | null {
  const { envVar, settingsKey, gcloudCmd, defaultValue } = options;

  // 1. Environment variable
  const envValue = process.env[envVar];
  if (envValue) {
    return envValue;
  }

  // 2. Settings file
  if (existsSync(SETTINGS_FILE)) {
    try {
      const content = readFileSync(SETTINGS_FILE, "utf-8");
      const match = content.match(new RegExp(`^${settingsKey}:\\s*(.+)$`, "m"));
      if (match) {
        return match[1].trim();
      }
    } catch {
      // Ignore file read errors
    }
  }

  // 3. gcloud command (if provided)
  if (gcloudCmd) {
    try {
      const result = Bun.spawnSync(["sh", "-c", gcloudCmd], {
        stdout: "pipe",
        stderr: "pipe",
        timeout: 3000,
      });
      if (!result.success) return defaultValue ?? null;
      return result.stdout.toString().trim() || null;
    } catch {
      return defaultValue ?? null;
    }
  }

  // 4. Default value
  return defaultValue ?? null;
}

/**
 * Get GCP project ID for Gemini API
 * Priority: 1. Environment variable, 2. Settings file, 3. gcloud default
 */
export function getGcpProject(): string | null {
  return getConfigValue({
    envVar: "GEMINI_GCP_PROJECT",
    settingsKey: "gcp_project",
    gcloudCmd: "gcloud config get-value project",
  });
}

/**
 * Get GCP location for Gemini API
 * Priority: 1. Environment variable, 2. Settings file, 3. Default (asia-northeast1)
 */
export function getGcpLocation(): string {
  return (
    getConfigValue({
      envVar: "GEMINI_GCP_LOCATION",
      settingsKey: "gcp_location",
      defaultValue: "asia-northeast1",
    }) ?? "asia-northeast1"
  );
}
