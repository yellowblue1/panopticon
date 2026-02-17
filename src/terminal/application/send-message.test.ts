import { describe, expect, it, mock } from "bun:test";
import type { SaveFileResult } from "../infrastructure/file-upload";
import { type SendMessageDeps, sendMessage } from "./send-message";

function createMockDeps(overrides: Partial<SendMessageDeps> = {}): SendMessageDeps {
  return {
    sendKeys: mock(() => true),
    saveFile: mock(
      (_data: ArrayBuffer, originalName: string, mimeType: string): SaveFileResult => ({
        ok: true,
        file: {
          originalName,
          savedPath: `/tmp/panopticon-uploads/123-abc-${originalName}`,
          mimeType,
          size: 100,
        },
      }),
    ),
    ...overrides,
  };
}

describe("sendMessage", () => {
  it("sends text-only message via sendKeys", () => {
    const deps = createMockDeps();
    const result = sendMessage({ paneId: "%0", text: "hello", files: [] }, deps);

    expect(result.success).toBe(true);
    expect(result.uploadedFiles).toHaveLength(0);
    expect(deps.sendKeys).toHaveBeenCalledWith("%0", "hello");
  });

  it("trims whitespace from text", () => {
    const deps = createMockDeps();
    sendMessage({ paneId: "%0", text: "  hello  ", files: [] }, deps);

    expect(deps.sendKeys).toHaveBeenCalledWith("%0", "hello");
  });

  it("sends files-only with file paths", () => {
    const deps = createMockDeps();
    const files = [{ data: new ArrayBuffer(10), name: "screenshot.png", type: "image/png" }];
    const result = sendMessage({ paneId: "%0", text: "", files }, deps);

    expect(result.success).toBe(true);
    expect(result.uploadedFiles).toHaveLength(1);
    expect(deps.sendKeys).toHaveBeenCalledWith(
      "%0",
      "/tmp/panopticon-uploads/123-abc-screenshot.png",
    );
  });

  it("composes text + files with blank line separator", () => {
    const deps = createMockDeps();
    const files = [
      { data: new ArrayBuffer(10), name: "img.png", type: "image/png" },
      { data: new ArrayBuffer(20), name: "doc.pdf", type: "application/pdf" },
    ];
    const result = sendMessage({ paneId: "%0", text: "check this", files }, deps);

    expect(result.success).toBe(true);
    expect(result.uploadedFiles).toHaveLength(2);
    expect(deps.sendKeys).toHaveBeenCalledWith(
      "%0",
      "check this\n\n/tmp/panopticon-uploads/123-abc-img.png\n/tmp/panopticon-uploads/123-abc-doc.pdf",
    );
  });

  it("returns error when text and files are both empty", () => {
    const deps = createMockDeps();
    const result = sendMessage({ paneId: "%0", text: "", files: [] }, deps);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Must provide text or files");
  });

  it("returns error when files exceed maximum count", () => {
    const deps = createMockDeps();
    const files = Array.from({ length: 6 }, (_, i) => ({
      data: new ArrayBuffer(10),
      name: `file${i}.png`,
      type: "image/png",
    }));
    const result = sendMessage({ paneId: "%0", text: "test", files }, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Maximum");
  });

  it("returns error with reason when saveFile fails", () => {
    const deps = createMockDeps({
      saveFile: mock(
        (): SaveFileResult => ({ ok: false, reason: "Unsupported file type: text/javascript" }),
      ),
    });
    const files = [{ data: new ArrayBuffer(10), name: "bad.exe", type: "text/javascript" }];
    const result = sendMessage({ paneId: "%0", text: "test", files }, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to save file");
    expect(result.error).toContain("Unsupported file type");
    expect(deps.sendKeys).not.toHaveBeenCalled();
  });

  it("returns error when sendKeys fails", () => {
    const deps = createMockDeps({ sendKeys: mock(() => false) });
    const result = sendMessage({ paneId: "%0", text: "hello", files: [] }, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to send message");
  });

  it("returns uploaded file metadata on success", () => {
    const deps = createMockDeps();
    const files = [{ data: new ArrayBuffer(10), name: "test.png", type: "image/png" }];
    const result = sendMessage({ paneId: "%0", text: "msg", files }, deps);

    expect(result.success).toBe(true);
    expect(result.uploadedFiles).toHaveLength(1);
    expect(result.uploadedFiles[0].originalName).toBe("test.png");
    expect(result.uploadedFiles[0].savedPath).toContain("test.png");
    expect(result.uploadedFiles[0].mimeType).toBe("image/png");
  });
});
