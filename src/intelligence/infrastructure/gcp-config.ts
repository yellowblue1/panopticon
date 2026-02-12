interface ConfigOptions {
  envVar: string;
  gcloudCmd?: string;
  defaultValue?: string;
}

function getConfigValue(options: ConfigOptions): string | null {
  const { envVar, gcloudCmd, defaultValue } = options;

  // 1. Environment variable
  const envValue = process.env[envVar];
  if (envValue) {
    return envValue;
  }

  // 2. gcloud command (if provided)
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

  // 3. Default value
  return defaultValue ?? null;
}

/**
 * Get GCP project ID for Gemini API
 * Priority: 1. Environment variable, 2. gcloud default
 */
export function getGcpProject(): string | null {
  return getConfigValue({
    envVar: "GEMINI_GCP_PROJECT",
    gcloudCmd: "gcloud config get-value project",
  });
}

/**
 * Get GCP location for Gemini API
 * Priority: 1. Environment variable, 2. Default (asia-northeast1)
 */
export function getGcpLocation(): string {
  return (
    getConfigValue({
      envVar: "GEMINI_GCP_LOCATION",
      defaultValue: "asia-northeast1",
    }) ?? "asia-northeast1"
  );
}
