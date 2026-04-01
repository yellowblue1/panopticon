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
    sleep: mock(() => Promise.resolve()),
    ...overrides,
  };
}

describe("sendMessage", () => {
  it("sends text-only message via sendKeys", async () => {
    const deps = createMockDeps();
    const result = await sendMessage({ paneId: "%0", text: "hello", files: [] }, deps);

    expect(result.success).toBe(true);
    expect(result.uploadedFiles).toHaveLength(0);
    expect(deps.sendKeys).toHaveBeenCalledWith("%0", "hello");
  });

  it("trims whitespace from text", async () => {
    const deps = createMockDeps();
    await sendMessage({ paneId: "%0", text: "  hello  ", files: [] }, deps);

    expect(deps.sendKeys).toHaveBeenCalledWith("%0", "hello");
  });

  it("sends files-only with one sendKeys call per file", async () => {
    const deps = createMockDeps();
    const files = [{ data: new ArrayBuffer(10), name: "screenshot.png", type: "image/png" }];
    const result = await sendMessage({ paneId: "%0", text: "", files }, deps);

    expect(result.success).toBe(true);
    expect(result.uploadedFiles).toHaveLength(1);
    expect(deps.sendKeys).toHaveBeenCalledTimes(1);
    expect(deps.sendKeys).toHaveBeenCalledWith(
      "%0",
      "/tmp/panopticon-uploads/123-abc-screenshot.png",
    );
  });

  it("sends file paths individually then text as separate sendKeys calls", async () => {
    const deps = createMockDeps();
    const files = [
      { data: new ArrayBuffer(10), name: "img.png", type: "image/png" },
      { data: new ArrayBuffer(20), name: "doc.pdf", type: "application/pdf" },
    ];
    const result = await sendMessage({ paneId: "%0", text: "check this", files }, deps);

    expect(result.success).toBe(true);
    expect(result.uploadedFiles).toHaveLength(2);
    expect(deps.sendKeys).toHaveBeenCalledTimes(3);
    expect(deps.sendKeys).toHaveBeenNthCalledWith(
      1,
      "%0",
      "/tmp/panopticon-uploads/123-abc-img.png",
    );
    expect(deps.sendKeys).toHaveBeenNthCalledWith(
      2,
      "%0",
      "/tmp/panopticon-uploads/123-abc-doc.pdf",
    );
    expect(deps.sendKeys).toHaveBeenNthCalledWith(3, "%0", "check this");
  });

  it("returns error when text and files are both empty", async () => {
    const deps = createMockDeps();
    const result = await sendMessage({ paneId: "%0", text: "", files: [] }, deps);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Must provide text or files");
  });

  it("returns error when files exceed maximum count", async () => {
    const deps = createMockDeps();
    const files = Array.from({ length: 6 }, (_, i) => ({
      data: new ArrayBuffer(10),
      name: `file${i}.png`,
      type: "image/png",
    }));
    const result = await sendMessage({ paneId: "%0", text: "test", files }, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Maximum");
  });

  it("returns error with reason when saveFile fails", async () => {
    const deps = createMockDeps({
      saveFile: mock(
        (): SaveFileResult => ({ ok: false, reason: "Unsupported file type: text/javascript" }),
      ),
    });
    const files = [{ data: new ArrayBuffer(10), name: "bad.exe", type: "text/javascript" }];
    const result = await sendMessage({ paneId: "%0", text: "test", files }, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to save file");
    expect(result.error).toContain("Unsupported file type");
    expect(deps.sendKeys).not.toHaveBeenCalled();
  });

  it("returns error when sendKeys fails", async () => {
    const deps = createMockDeps({ sendKeys: mock(() => false) });
    const result = await sendMessage({ paneId: "%0", text: "hello", files: [] }, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to send text to pane");
  });

  it("returns uploaded file metadata on success", async () => {
    const deps = createMockDeps();
    const files = [{ data: new ArrayBuffer(10), name: "test.png", type: "image/png" }];
    const result = await sendMessage({ paneId: "%0", text: "msg", files }, deps);

    expect(result.success).toBe(true);
    expect(result.uploadedFiles).toHaveLength(1);
    expect(result.uploadedFiles[0].originalName).toBe("test.png");
    expect(result.uploadedFiles[0].savedPath).toContain("test.png");
    expect(result.uploadedFiles[0].mimeType).toBe("image/png");
  });
});
