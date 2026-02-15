import { describe, expect, test } from "bun:test";
import { formatRelativeTime } from "./format-relative-time";

describe("formatRelativeTime", () => {
  const now = Date.now();

  test("returns 'just now' for timestamps less than 60 seconds ago", () => {
    expect(formatRelativeTime(now - 0)).toBe("just now");
    expect(formatRelativeTime(now - 30_000)).toBe("just now");
    expect(formatRelativeTime(now - 59_000)).toBe("just now");
  });

  test("returns minutes ago for timestamps 1-59 minutes ago", () => {
    expect(formatRelativeTime(now - 60_000)).toBe("1m ago");
    expect(formatRelativeTime(now - 5 * 60_000)).toBe("5m ago");
    expect(formatRelativeTime(now - 59 * 60_000)).toBe("59m ago");
  });

  test("returns hours ago for timestamps 1-23 hours ago", () => {
    expect(formatRelativeTime(now - 60 * 60_000)).toBe("1h ago");
    expect(formatRelativeTime(now - 3 * 60 * 60_000)).toBe("3h ago");
    expect(formatRelativeTime(now - 23 * 60 * 60_000)).toBe("23h ago");
  });

  test("returns days ago for timestamps 24+ hours ago", () => {
    expect(formatRelativeTime(now - 24 * 60 * 60_000)).toBe("1d ago");
    expect(formatRelativeTime(now - 7 * 24 * 60 * 60_000)).toBe("7d ago");
    expect(formatRelativeTime(now - 30 * 24 * 60 * 60_000)).toBe("30d ago");
  });

  test("floors the time difference", () => {
    // 1 minute 45 seconds -> "1m ago", not "2m ago"
    expect(formatRelativeTime(now - 105_000)).toBe("1m ago");
    // 2 hours 59 minutes -> "2h ago"
    expect(formatRelativeTime(now - (2 * 60 * 60_000 + 59 * 60_000))).toBe("2h ago");
  });
});
