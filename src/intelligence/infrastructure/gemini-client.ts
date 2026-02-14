import { GoogleGenAI } from "@google/genai";
import type { GenerateContentFn } from "../domain/ports";
import { clearAuthError, hasAuthError, setAuthError } from "./auth-error-state";

const REQUEST_TIMEOUT_MS = 10000;

const AUTH_ERROR_PATTERNS = [
  "invalid_grant",
  "invalid_rapt",
  "token has been expired or revoked",
  "request had insufficient authentication scopes",
];

/**
 * Check if an error represents a Gemini authentication/authorization failure.
 * Detects HTTP 401/403 status codes and common auth error message patterns.
 */
export function isAuthError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  const status = (err as { status?: number }).status;
  if (status === 401 || status === 403) return true;

  const msg = err.message.toLowerCase();
  return AUTH_ERROR_PATTERNS.some((pattern) => msg.includes(pattern));
}

function createClient(): GoogleGenAI {
  return new GoogleGenAI({});
}

/**
 * Create a GenerateContentFn backed by the @google/genai SDK.
 *
 * The SDK reads configuration from environment variables automatically
 * (GOOGLE_API_KEY / GEMINI_API_KEY for Google AI, or GOOGLE_CLOUD_PROJECT /
 * GOOGLE_CLOUD_LOCATION with GOOGLE_GENAI_USE_VERTEXAI for Vertex AI).
 * Call {@link bootstrapGeminiEnv} before using this function to ensure
 * the environment is properly set up.
 *
 * Detects auth errors and updates the module-level auth error state.
 * Recreates the SDK client when recovering from auth errors to pick up
 * refreshed credentials.
 */
export function createGenerateContentFn(model: string): GenerateContentFn {
  let ai = createClient();

  return async (prompt, options) => {
    // Recreate client when recovering from auth error to pick up new credentials.
    // The SDK caches credentials in memory, so a new instance is needed.
    if (hasAuthError()) {
      ai = createClient();
    }

    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: options?.responseMimeType,
          httpOptions: { timeout: REQUEST_TIMEOUT_MS },
        },
      });
      clearAuthError();
      return response.text ?? null;
    } catch (err) {
      if (isAuthError(err)) {
        const message = err instanceof Error ? err.message : "Authentication error";
        setAuthError(message);
      }
      throw err;
    }
  };
}
