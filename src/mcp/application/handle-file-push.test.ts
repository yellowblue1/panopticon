import { describe, expect, it } from "bun:test";
import type { FilePushSseEvent } from "../../shared/types";
import type { McpFilePushDeps } from "../domain/ports";
import { detectMimeType, handleFilePush } from "./handle-file-push";

function createMockDeps(overrides: Partial<McpFilePushDeps> = {}): McpFilePushDeps {
  return {
    readFile: () => Buffer.from("test-content"),
    getFileSize: () => 100,
    broadcastFilePush: () => {},
    ...overrides,
  };
}

function captureBroadcast(): {
  deps: McpFilePushDeps;
  getEvent: () => FilePushSseEvent;
} {
  let event: FilePushSseEvent | null = null;
  const deps = createMockDeps({
    broadcastFilePush: (e) => {
      event = e;
    },
  });
  return {
    deps,
    getEvent: () => {
      if (event === null) throw new Error("broadcastFilePush was not called");
      return event;
    },
  };
}

describe("handleFilePush", () => {
  it("returns error when file does not exist", () => {
    const deps = createMockDeps({ getFileSize: () => -1 });
    const result = handleFilePush({ filePath: "/missing/file.png", sessionId: "%0" }, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain("File not found");
    expect(result.filename).toBe("file.png");
  });

  it("returns error when file exceeds max size", () => {
    const deps = createMockDeps({ getFileSize: () => 11 * 1024 * 1024 });
    const result = handleFilePush({ filePath: "/big/file.png", sessionId: "%0" }, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain("exceeds maximum size");
  });

  it("returns error when file read fails", () => {
    const deps = createMockDeps({ readFile: () => null });
    const result = handleFilePush({ filePath: "/unreadable/file.png", sessionId: "%0" }, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to read file");
  });

  it("successfully pushes a file with base64 encoding", () => {
    const content = Buffer.from("hello world");
    const { deps, getEvent } = captureBroadcast();
    Object.assign(deps, {
      readFile: () => content,
      getFileSize: () => content.length,
    });

    const result = handleFilePush({ filePath: "/path/to/image.png", sessionId: "%0" }, deps);

    expect(result.success).toBe(true);
    expect(result.filename).toBe("image.png");
    expect(result.mimeType).toBe("image/png");
    expect(result.size).toBe(content.length);
    expect(result.error).toBeUndefined();

    const event = getEvent();
    expect(event.type).toBe("file_push");
    expect(event.filename).toBe("image.png");
    expect(event.mimeType).toBe("image/png");
    expect(event.base64).toBe(content.toString("base64"));
    expect(event.sessionId).toBe("%0");
  });

  it("uses custom filename when provided", () => {
    const { deps, getEvent } = captureBroadcast();

    const result = handleFilePush(
      { filePath: "/path/to/image.png", filename: "screenshot.png", sessionId: "%0" },
      deps,
    );

    expect(result.filename).toBe("screenshot.png");
    expect(getEvent().filename).toBe("screenshot.png");
  });

  it("passes sessionId through to SSE event", () => {
    const { deps, getEvent } = captureBroadcast();

    handleFilePush({ filePath: "/path/to/file.txt", sessionId: "pane-42" }, deps);

    expect(getEvent().sessionId).toBe("pane-42");
  });

  it("does not broadcast when file is not found", () => {
    let broadcastCalled = false;
    const deps = createMockDeps({
      getFileSize: () => -1,
      broadcastFilePush: () => {
        broadcastCalled = true;
      },
    });

    handleFilePush({ filePath: "/missing.png", sessionId: "%0" }, deps);
    expect(broadcastCalled).toBe(false);
  });
});

describe("detectMimeType", () => {
  it("detects common image types", () => {
    expect(detectMimeType("photo.png")).toBe("image/png");
    expect(detectMimeType("photo.jpg")).toBe("image/jpeg");
    expect(detectMimeType("photo.jpeg")).toBe("image/jpeg");
    expect(detectMimeType("photo.gif")).toBe("image/gif");
    expect(detectMimeType("photo.webp")).toBe("image/webp");
    expect(detectMimeType("icon.svg")).toBe("image/svg+xml");
  });

  it("detects document types", () => {
    expect(detectMimeType("doc.pdf")).toBe("application/pdf");
    expect(detectMimeType("readme.txt")).toBe("text/plain");
    expect(detectMimeType("data.json")).toBe("application/json");
    expect(detectMimeType("page.html")).toBe("text/html");
    expect(detectMimeType("data.csv")).toBe("text/csv");
  });

  it("returns octet-stream for unknown extensions", () => {
    expect(detectMimeType("file.xyz")).toBe("application/octet-stream");
    expect(detectMimeType("binary")).toBe("application/octet-stream");
  });

  it("is case-insensitive for extensions", () => {
    expect(detectMimeType("photo.PNG")).toBe("image/png");
    expect(detectMimeType("photo.JPG")).toBe("image/jpeg");
  });
});
