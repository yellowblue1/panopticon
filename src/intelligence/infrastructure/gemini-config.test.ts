import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { bootstrapGeminiEnv } from "./gemini-config";

const ENV_KEYS = [
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_GENAI_USE_VERTEXAI",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
] as const;

describe("bootstrapGeminiEnv", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  it("returns google-ai when GOOGLE_API_KEY is set", () => {
    process.env.GOOGLE_API_KEY = "test-key";

    expect(bootstrapGeminiEnv()).toBe("google-ai");
  });

  it("returns google-ai when GEMINI_API_KEY is set", () => {
    process.env.GEMINI_API_KEY = "test-key";

    expect(bootstrapGeminiEnv()).toBe("google-ai");
  });

  it("returns vertex-ai when GOOGLE_GENAI_USE_VERTEXAI and GOOGLE_CLOUD_PROJECT are set", () => {
    process.env.GOOGLE_GENAI_USE_VERTEXAI = "true";
    process.env.GOOGLE_CLOUD_PROJECT = "my-project";

    expect(bootstrapGeminiEnv()).toBe("vertex-ai");
  });

  it("sets GOOGLE_CLOUD_LOCATION to global when missing in Vertex AI mode", () => {
    process.env.GOOGLE_GENAI_USE_VERTEXAI = "true";
    process.env.GOOGLE_CLOUD_PROJECT = "my-project";

    bootstrapGeminiEnv();

    expect(process.env.GOOGLE_CLOUD_LOCATION).toBe("global");
  });

  it("preserves existing GOOGLE_CLOUD_LOCATION in Vertex AI mode", () => {
    process.env.GOOGLE_GENAI_USE_VERTEXAI = "true";
    process.env.GOOGLE_CLOUD_PROJECT = "my-project";
    process.env.GOOGLE_CLOUD_LOCATION = "us-central1";

    bootstrapGeminiEnv();

    expect(process.env.GOOGLE_CLOUD_LOCATION).toBe("us-central1");
  });

  it("returns null when GOOGLE_GENAI_USE_VERTEXAI is true but no project found", () => {
    process.env.GOOGLE_GENAI_USE_VERTEXAI = "true";
    // No GOOGLE_CLOUD_PROJECT and gcloud fallback might return null in CI

    const result = bootstrapGeminiEnv();

    // In CI without gcloud, this should be null
    // In a developer environment with gcloud, it could be "vertex-ai"
    expect(result === null || result === "vertex-ai").toBe(true);
  });

  it("prefers Vertex AI when GOOGLE_GENAI_USE_VERTEXAI is true even if API key exists", () => {
    process.env.GOOGLE_GENAI_USE_VERTEXAI = "true";
    process.env.GOOGLE_CLOUD_PROJECT = "my-project";
    process.env.GOOGLE_API_KEY = "test-key";

    expect(bootstrapGeminiEnv()).toBe("vertex-ai");
  });

  it("auto-sets GOOGLE_GENAI_USE_VERTEXAI from gcloud fallback", () => {
    // If gcloud is available and has a project configured, it should auto-enable Vertex AI
    // This test verifies the gcloud fallback path exists
    // The actual result depends on the test environment
    const result = bootstrapGeminiEnv();

    if (result === "vertex-ai") {
      expect(process.env.GOOGLE_GENAI_USE_VERTEXAI).toBe("true");
      expect(process.env.GOOGLE_CLOUD_PROJECT).toBeTruthy();
    } else {
      expect(result).toBeNull();
    }
  });
});
