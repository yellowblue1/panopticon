import { describe, expect, it } from "bun:test";
import { isAuthError } from "./gemini-client";

describe("isAuthError", () => {
  it("returns true for error with status 401", () => {
    const err = new Error("Unauthorized");
    (err as Error & { status: number }).status = 401;
    expect(isAuthError(err)).toBe(true);
  });

  it("returns true for error with status 403", () => {
    const err = new Error("Forbidden");
    (err as Error & { status: number }).status = 403;
    expect(isAuthError(err)).toBe(true);
  });

  it("returns true for error with invalid_grant message", () => {
    const err = new Error('{"error":"invalid_grant","error_description":"reauth related error"}');
    expect(isAuthError(err)).toBe(true);
  });

  it("returns true for error with invalid_rapt message", () => {
    const err = new Error("reauth related error (invalid_rapt)");
    expect(isAuthError(err)).toBe(true);
  });

  it("returns true for token expired message", () => {
    const err = new Error("Token has been expired or revoked");
    expect(isAuthError(err)).toBe(true);
  });

  it("returns true for insufficient scopes message", () => {
    const err = new Error("Request had insufficient authentication scopes");
    expect(isAuthError(err)).toBe(true);
  });

  it("returns false for regular error", () => {
    const err = new Error("Network timeout");
    expect(isAuthError(err)).toBe(false);
  });

  it("returns false for error with non-auth status", () => {
    const err = new Error("Internal Server Error");
    (err as Error & { status: number }).status = 500;
    expect(isAuthError(err)).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isAuthError("string error")).toBe(false);
    expect(isAuthError(null)).toBe(false);
    expect(isAuthError(undefined)).toBe(false);
    expect(isAuthError(42)).toBe(false);
  });
});
