import { describe, expect, it, mock } from "bun:test";
import type { SaveFileResult } from "../infrastructure/file-upload";
import { type SendMessageDeps, sendMessage } from "./send-message";

interface CallLogEntry {
  kind: "pastePath" | "sendLiteral" | "sendEnter" | "sleep";
  paneId?: string;
  payload?: string;
  ms?: number;
}

function createMockDeps(overrides: Partial<SendMessageDeps> = {}): {
  deps: SendMessageDeps;
  calls: CallLogEntry[];
} {
  const calls: CallLogEntry[] = [];
  const deps: SendMessageDeps = {
    pastePath: mock((paneId: string, content: string) => {
      calls.push({ kind: "pastePath", paneId, payload: content });
      return true;
    }),
    sendLiteral: mock((paneId: string, text: string) => {
      calls.push({ kind: "sendLiteral", paneId, payload: text });
      return true;
    }),
    sendEnter: mock((paneId: string) => {
      calls.push({ kind: "sendEnter", paneId });
      return true;
    }),
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
    sleep: mock((ms: number) => {
      calls.push({ kind: "sleep", ms });
      return Promise.resolve();
    }),
    ...overrides,
  };
  return { deps, calls };
}

describe("sendMessage", () => {
  it("sends text-only message as literal + single Enter", async () => {
    const { deps, calls } = createMockDeps();
    const result = await sendMessage({ paneId: "%0", text: "hello", files: [] }, deps);

    expect(result.success).toBe(true);
    expect(result.uploadedFiles).toHaveLength(0);
    expect(calls).toEqual([
      { kind: "sendLiteral", paneId: "%0", payload: "hello" },
      { kind: "sendEnter", paneId: "%0" },
    ]);
  });

  it("trims whitespace from text", async () => {
    const { deps, calls } = createMockDeps();
    await sendMessage({ paneId: "%0", text: "  hello  ", files: [] }, deps);
    expect(calls[0]).toEqual({ kind: "sendLiteral", paneId: "%0", payload: "hello" });
  });

  it("pastes image path via bracketed paste then submits with single Enter", async () => {
    const { deps, calls } = createMockDeps();
    const files = [{ data: new ArrayBuffer(10), name: "screenshot.png", type: "image/png" }];
    const result = await sendMessage({ paneId: "%0", text: "", files }, deps);

    expect(result.success).toBe(true);
    expect(result.uploadedFiles).toHaveLength(1);
    expect(calls).toEqual([
      {
        kind: "pastePath",
        paneId: "%0",
        payload: "/tmp/panopticon-uploads/123-abc-screenshot.png",
      },
      { kind: "sleep", ms: 50 },
      { kind: "sendEnter", paneId: "%0" },
    ]);
  });

  it("inserts PDF as literal path (no bracketed paste, no flush delay)", async () => {
    const { deps, calls } = createMockDeps();
    const files = [{ data: new ArrayBuffer(10), name: "doc.pdf", type: "application/pdf" }];
    const result = await sendMessage({ paneId: "%0", text: "", files }, deps);

    expect(result.success).toBe(true);
    expect(calls).toEqual([
      {
        kind: "sendLiteral",
        paneId: "%0",
        payload: "/tmp/panopticon-uploads/123-abc-doc.pdf",
      },
      { kind: "sendEnter", paneId: "%0" },
    ]);
    // PDF must NOT go through bracketed paste and must NOT incur the
    // post-paste flush delay.
    expect(calls.some((c) => c.kind === "pastePath")).toBe(false);
    expect(calls.some((c) => c.kind === "sleep")).toBe(false);
  });

  it("composes images, PDF, and text into a single message with one Enter", async () => {
    const { deps, calls } = createMockDeps();
    const files = [
      { data: new ArrayBuffer(10), name: "a.png", type: "image/png" },
      { data: new ArrayBuffer(10), name: "b.jpg", type: "image/jpeg" },
      { data: new ArrayBuffer(20), name: "c.pdf", type: "application/pdf" },
    ];
    const result = await sendMessage({ paneId: "%0", text: "describe these", files }, deps);

    expect(result.success).toBe(true);
    expect(calls).toEqual([
      { kind: "pastePath", paneId: "%0", payload: "/tmp/panopticon-uploads/123-abc-a.png" },
      { kind: "sleep", ms: 50 },
      { kind: "sendLiteral", paneId: "%0", payload: " " },
      { kind: "pastePath", paneId: "%0", payload: "/tmp/panopticon-uploads/123-abc-b.jpg" },
      { kind: "sleep", ms: 50 },
      { kind: "sendLiteral", paneId: "%0", payload: " " },
      { kind: "sendLiteral", paneId: "%0", payload: "/tmp/panopticon-uploads/123-abc-c.pdf" },
      { kind: "sendLiteral", paneId: "%0", payload: " " },
      { kind: "sendLiteral", paneId: "%0", payload: "describe these" },
      { kind: "sendEnter", paneId: "%0" },
    ]);
  });

  it("returns error when text and files are both empty", async () => {
    const { deps } = createMockDeps();
    const result = await sendMessage({ paneId: "%0", text: "", files: [] }, deps);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Must provide text or files");
  });

  it("returns error when files exceed maximum count", async () => {
    const { deps } = createMockDeps();
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
    const { deps, calls } = createMockDeps({
      saveFile: mock(
        (): SaveFileResult => ({ ok: false, reason: "Unsupported file type: text/javascript" }),
      ),
    });
    const files = [{ data: new ArrayBuffer(10), name: "bad.exe", type: "text/javascript" }];
    const result = await sendMessage({ paneId: "%0", text: "test", files }, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to save file");
    expect(result.error).toContain("Unsupported file type");
    expect(calls).toHaveLength(0);
  });

  it("returns error when pastePath fails for an image", async () => {
    const { deps } = createMockDeps({ pastePath: mock(() => false) });
    const files = [{ data: new ArrayBuffer(10), name: "img.png", type: "image/png" }];
    const result = await sendMessage({ paneId: "%0", text: "check", files }, deps);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed to send to pane");
  });

  it("returns error when sendLiteral fails on the separator space between parts", async () => {
    const literalCalls: string[] = [];
    const { deps, calls } = createMockDeps({
      sendLiteral: mock((_paneId: string, text: string) => {
        literalCalls.push(text);
        calls.push({ kind: "sendLiteral", paneId: _paneId, payload: text });
        return text !== " ";
      }),
    });
    const files = [{ data: new ArrayBuffer(10), name: "img.png", type: "image/png" }];
    const result = await sendMessage({ paneId: "%0", text: "hi", files }, deps);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed to send to pane");
    expect(literalCalls).toEqual([" "]);
    // pastePath happened, the space attempt happened, then we bailed — no
    // text send, no Enter.
    expect(calls.some((c) => c.kind === "pastePath")).toBe(true);
    expect(calls.some((c) => c.kind === "sendLiteral" && c.payload === "hi")).toBe(false);
    expect(calls.some((c) => c.kind === "sendEnter")).toBe(false);
  });

  it("returns error when sendLiteral fails on the separator space between files", async () => {
    const { deps, calls } = createMockDeps({
      sendLiteral: mock((_paneId: string, text: string) => {
        calls.push({ kind: "sendLiteral", paneId: _paneId, payload: text });
        return text !== " ";
      }),
    });
    const files = [
      { data: new ArrayBuffer(10), name: "a.png", type: "image/png" },
      { data: new ArrayBuffer(10), name: "b.png", type: "image/png" },
    ];
    const result = await sendMessage({ paneId: "%0", text: "", files }, deps);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed to send to pane");
    // Only the first image was pasted; the separator failed, so the second
    // image was never attempted and Enter was not sent.
    expect(calls.filter((c) => c.kind === "pastePath")).toHaveLength(1);
    expect(calls.some((c) => c.kind === "sendLiteral" && c.payload === " ")).toBe(true);
    expect(calls.some((c) => c.kind === "sendEnter")).toBe(false);
  });

  it("returns error when sendLiteral fails for text", async () => {
    const { deps } = createMockDeps({ sendLiteral: mock(() => false) });
    const result = await sendMessage({ paneId: "%0", text: "hello", files: [] }, deps);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed to send to pane");
  });

  it("returns error when sendEnter fails", async () => {
    const { deps } = createMockDeps({ sendEnter: mock(() => false) });
    const result = await sendMessage({ paneId: "%0", text: "hello", files: [] }, deps);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed to send to pane");
  });

  it("returns uploaded file metadata on success", async () => {
    const { deps } = createMockDeps();
    const files = [{ data: new ArrayBuffer(10), name: "test.png", type: "image/png" }];
    const result = await sendMessage({ paneId: "%0", text: "msg", files }, deps);

    expect(result.success).toBe(true);
    expect(result.uploadedFiles).toHaveLength(1);
    expect(result.uploadedFiles[0].originalName).toBe("test.png");
    expect(result.uploadedFiles[0].savedPath).toContain("test.png");
    expect(result.uploadedFiles[0].mimeType).toBe("image/png");
  });
});
