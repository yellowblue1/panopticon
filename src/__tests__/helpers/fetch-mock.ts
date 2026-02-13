/**
 * Gemini SDK mock utilities for testing
 */

import type { GenerateContentFn } from "../../intelligence/domain/ports";

/**
 * Create a mock generateContent that returns the given text
 */
export function mockGenerateContent(text: string): GenerateContentFn {
  return async () => text;
}

/**
 * Create a mock generateContent that returns null (empty response)
 */
export function mockGenerateContentEmpty(): GenerateContentFn {
  return async () => null;
}

/**
 * Create a mock generateContent that throws an error
 */
export function mockGenerateContentError(message = "API error"): GenerateContentFn {
  return async () => {
    throw new Error(message);
  };
}

/**
 * Create a mock generateContent that throws an auth-like error (401 status)
 */
export function mockGenerateContentAuthError(message = "invalid_grant"): GenerateContentFn {
  return async () => {
    const err = new Error(message);
    (err as Error & { status: number }).status = 401;
    throw err;
  };
}
