import { describe, expect, test } from "bun:test";
import { formatFileSize } from "./format-file-size";

describe("formatFileSize", () => {
  test("formats bytes under 1 KB as B", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1023)).toBe("1023 B");
  });

  test("formats values between 1 KB and 1 MB as KB with one decimal", () => {
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(1024 * 1024 - 1)).toBe("1024.0 KB");
  });

  test("formats values at or above 1 MB as MB with one decimal", () => {
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatFileSize(10 * 1024 * 1024)).toBe("10.0 MB");
  });
});
