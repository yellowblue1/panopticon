import { beforeEach, describe, expect, it } from "bun:test";
import {
  clearAuthError,
  getAuthErrorMessage,
  hasAuthError,
  resetAuthErrorState,
  setAuthError,
} from "./auth-error-state";

describe("auth-error-state", () => {
  beforeEach(() => {
    resetAuthErrorState();
  });

  it("initially has no auth error", () => {
    expect(hasAuthError()).toBe(false);
    expect(getAuthErrorMessage()).toBeNull();
  });

  it("setAuthError sets error state", () => {
    setAuthError("invalid_grant");
    expect(hasAuthError()).toBe(true);
    expect(getAuthErrorMessage()).toBe("invalid_grant");
  });

  it("clearAuthError clears error state", () => {
    setAuthError("invalid_grant");
    clearAuthError();
    expect(hasAuthError()).toBe(false);
    expect(getAuthErrorMessage()).toBeNull();
  });

  it("setAuthError overwrites previous error", () => {
    setAuthError("invalid_grant");
    setAuthError("invalid_rapt");
    expect(getAuthErrorMessage()).toBe("invalid_rapt");
  });

  it("resetAuthErrorState clears everything", () => {
    setAuthError("test error");
    resetAuthErrorState();
    expect(hasAuthError()).toBe(false);
    expect(getAuthErrorMessage()).toBeNull();
  });
});
