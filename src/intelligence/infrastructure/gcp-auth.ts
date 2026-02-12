/**
 * Get gcloud access token for API authentication
 */
export function getAccessToken(): string | null {
  try {
    const result = Bun.spawnSync(["sh", "-c", "gcloud auth print-access-token"], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 5000,
    });
    if (!result.success) return null;
    return result.stdout.toString().trim() || null;
  } catch {
    return null;
  }
}
