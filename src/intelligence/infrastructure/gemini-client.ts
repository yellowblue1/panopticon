import { GoogleGenAI } from "@google/genai";
import type { GenerateContentFn } from "../domain/ports";
import { clearAuthError, setAuthError } from "./auth-error-state";

const MODEL_ID = "gemini-2.5-flash";
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

/**
 * Create a GenerateContentFn backed by the @google/genai SDK.
 * Authentication is handled automatically via Application Default Credentials.
 * Detects auth errors and updates the module-level auth error state.
 */
export function createGenerateContentFn(project: string, location: string): GenerateContentFn {
  const ai = new GoogleGenAI({
    vertexai: true,
    project,
    location,
  });

  return async (prompt, options) => {
    try {
      const response = await ai.models.generateContent({
        model: MODEL_ID,
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
