/**
 * Gemini SDK environment bootstrap.
 *
 * Detects which Gemini backend is available (Google AI via API key or
 * Vertex AI via ADC) and sets the standard environment variables that
 * the @google/genai SDK reads automatically.
 *
 * Call {@link bootstrapGeminiEnv} once at startup, before creating any
 * GoogleGenAI instances.
 */

import type { GeminiBackend } from "../../shared/types";

/**
 * Detect the Gemini backend and bootstrap SDK environment variables.
 *
 * Detection order:
 * 1. `GOOGLE_GENAI_USE_VERTEXAI=true` — explicit Vertex AI request.
 *    Fills in `GOOGLE_CLOUD_PROJECT` from gcloud if missing.
 * 2. `GOOGLE_API_KEY` / `GEMINI_API_KEY` — Google AI (API key) mode.
 * 3. gcloud project fallback — auto-enables Vertex AI for backward
 *    compatibility with existing setups that rely on `gcloud config`.
 *
 * @returns The detected backend, or `null` if nothing is configured.
 */
export function bootstrapGeminiEnv(): GeminiBackend | null {
  // 1. Explicit Vertex AI flag
  if (process.env.GOOGLE_GENAI_USE_VERTEXAI?.toLowerCase() === "true") {
    if (!process.env.GOOGLE_CLOUD_PROJECT) {
      const project = getProjectFromGcloud();
      if (project) process.env.GOOGLE_CLOUD_PROJECT = project;
    }
    if (!process.env.GOOGLE_CLOUD_LOCATION) {
      process.env.GOOGLE_CLOUD_LOCATION = "global";
    }
    return process.env.GOOGLE_CLOUD_PROJECT ? "vertex-ai" : null;
  }

  // 2. API key → Google AI mode
  if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) {
    return "google-ai";
  }

  // 3. Auto-detect from gcloud (backward compat)
  const project = getProjectFromGcloud();
  if (project) {
    process.env.GOOGLE_CLOUD_PROJECT = project;
    process.env.GOOGLE_GENAI_USE_VERTEXAI = "true";
    if (!process.env.GOOGLE_CLOUD_LOCATION) {
      process.env.GOOGLE_CLOUD_LOCATION = "global";
    }
    return "vertex-ai";
  }

  return null;
}

function getProjectFromGcloud(): string | null {
  try {
    const result = Bun.spawnSync(["sh", "-c", "gcloud config get-value project"], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 3000,
    });
    if (!result.success) return null;
    return result.stdout.toString().trim() || null;
  } catch {
    return null;
  }
}
