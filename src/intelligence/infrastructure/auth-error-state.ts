/**
 * Module-level auth error state for the intelligence bounded context.
 * Tracks whether Gemini API authentication is currently failing at runtime.
 */

let authError = false;
let lastErrorMessage: string | null = null;

export function setAuthError(message: string): void {
  authError = true;
  lastErrorMessage = message;
}

export function clearAuthError(): void {
  authError = false;
  lastErrorMessage = null;
}

export function hasAuthError(): boolean {
  return authError;
}

export function getAuthErrorMessage(): string | null {
  return lastErrorMessage;
}

/** Reset all state — for tests only. */
export function resetAuthErrorState(): void {
  authError = false;
  lastErrorMessage = null;
}
