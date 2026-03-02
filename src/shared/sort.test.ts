import { describe, expect, it } from "bun:test";

import { compareWithHysteresis } from "./sort";

describe("compareWithHysteresis", () => {
  const base = "2026-03-02T00:00:00.000Z";

  function offsetMs(ms: number): string {
    return new Date(new Date(base).getTime() + ms).toISOString();
  }

  it("sorts by recency when difference exceeds threshold", () => {
    const older = base;
    const newer = offsetMs(10_000);

    const result = compareWithHysteresis(older, newer, -999);

    expect(result).toBe(1);
  });

  it("sorts in reverse when a is newer and difference exceeds threshold", () => {
    const older = base;
    const newer = offsetMs(10_000);

    const result = compareWithHysteresis(newer, older, -999);

    expect(result).toBe(-1);
  });

  it("uses tiebreaker when difference is within threshold", () => {
    const a = base;
    const b = offsetMs(3_000);

    expect(compareWithHysteresis(a, b, 42)).toBe(42);
    expect(compareWithHysteresis(b, a, -7)).toBe(-7);
  });

  it("uses tiebreaker when timestamps are identical", () => {
    expect(compareWithHysteresis(base, base, 1)).toBe(1);
    expect(compareWithHysteresis(base, base, 0)).toBe(0);
  });

  it("uses tiebreaker at exactly the threshold boundary", () => {
    const a = base;
    const b = offsetMs(5_000);

    expect(compareWithHysteresis(a, b, 99)).toBe(99);
  });

  it("sorts by recency when difference is 1ms beyond threshold", () => {
    const a = base;
    const b = offsetMs(5_001);

    expect(compareWithHysteresis(a, b, 99)).toBe(1);
  });

  it("respects custom threshold", () => {
    const a = base;
    const b = offsetMs(3_000);

    expect(compareWithHysteresis(a, b, 42, 2_000)).toBe(1);
    expect(compareWithHysteresis(a, b, 42, 4_000)).toBe(42);
  });
});
