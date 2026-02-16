import { describe, expect, test } from "bun:test";
import { hashContent } from "./hash-content";

describe("hashContent", () => {
  test("returns a non-empty string for non-empty input", () => {
    const result = hashContent("hello world");
    expect(result).toBeString();
    expect(result.length).toBeGreaterThan(0);
  });

  test("returns consistent hash for the same input", () => {
    const a = hashContent("test string");
    const b = hashContent("test string");
    expect(a).toBe(b);
  });

  test("returns different hashes for different inputs", () => {
    const a = hashContent("hello");
    const b = hashContent("world");
    expect(a).not.toBe(b);
  });

  test("returns empty string for empty input", () => {
    expect(hashContent("")).toBe("");
  });

  test("handles unicode content", () => {
    const a = hashContent("日本語テスト");
    const b = hashContent("日本語テスト");
    expect(a).toBe(b);

    const c = hashContent("日本語テスト2");
    expect(a).not.toBe(c);
  });

  test("returns base-36 encoded string", () => {
    const result = hashContent("some content");
    // base-36 contains only [0-9a-z]
    expect(result).toMatch(/^[0-9a-z]+$/);
  });
});
