import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getGcpLocation, getGcpProject } from "./gcp-config";

describe("config", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    originalEnv.GEMINI_GCP_PROJECT = process.env.GEMINI_GCP_PROJECT;
    originalEnv.GEMINI_GCP_LOCATION = process.env.GEMINI_GCP_LOCATION;
  });

  afterEach(() => {
    if (originalEnv.GEMINI_GCP_PROJECT === undefined) {
      delete process.env.GEMINI_GCP_PROJECT;
    } else {
      process.env.GEMINI_GCP_PROJECT = originalEnv.GEMINI_GCP_PROJECT;
    }

    if (originalEnv.GEMINI_GCP_LOCATION === undefined) {
      delete process.env.GEMINI_GCP_LOCATION;
    } else {
      process.env.GEMINI_GCP_LOCATION = originalEnv.GEMINI_GCP_LOCATION;
    }
  });

  describe("getGcpProject", () => {
    it("should return environment variable when set", () => {
      process.env.GEMINI_GCP_PROJECT = "env-project-id";

      const result = getGcpProject();

      expect(result).toBe("env-project-id");
    });

    it("should handle empty environment variable", () => {
      process.env.GEMINI_GCP_PROJECT = "";

      // Empty string is falsy, so it should fall through to gcloud
      const result = getGcpProject();

      expect(result).not.toBe("");
    });
  });

  describe("getGcpLocation", () => {
    it("should return environment variable when set", () => {
      process.env.GEMINI_GCP_LOCATION = "us-west1";

      const result = getGcpLocation();

      expect(result).toBe("us-west1");
    });

    it("should return default location when no env var", () => {
      delete process.env.GEMINI_GCP_LOCATION;

      const result = getGcpLocation();

      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("should prioritize environment variable over default", () => {
      process.env.GEMINI_GCP_LOCATION = "europe-west1";

      const result = getGcpLocation();

      expect(result).toBe("europe-west1");
    });
  });
});
