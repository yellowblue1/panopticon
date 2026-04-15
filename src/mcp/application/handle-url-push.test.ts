import { describe, expect, it } from "bun:test";
import type { UrlPushSseEvent } from "../../shared/types";
import type { McpUrlPushDeps } from "../domain/ports";
import { handleUrlPush } from "./handle-url-push";

function createMockDeps(overrides: Partial<McpUrlPushDeps> = {}): McpUrlPushDeps {
  return {
    broadcastUrlPush: () => {},
    ...overrides,
  };
}

function captureBroadcast(): {
  deps: McpUrlPushDeps;
  getEvent: () => UrlPushSseEvent;
} {
  let event: UrlPushSseEvent | null = null;
  const deps = createMockDeps({
    broadcastUrlPush: (e) => {
      event = e;
    },
  });
  return {
    deps,
    getEvent: () => {
      if (event === null) throw new Error("broadcastUrlPush was not called");
      return event;
    },
  };
}

describe("handleUrlPush", () => {
  it("returns error for invalid URL", () => {
    const deps = createMockDeps();
    const result = handleUrlPush({ url: "not-a-url" }, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid URL");
  });

  it("returns error for non-http protocol", () => {
    const deps = createMockDeps();
    const result = handleUrlPush({ url: "ftp://example.com/file" }, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unsupported protocol");
  });

  it("successfully pushes an http URL", () => {
    const { deps, getEvent } = captureBroadcast();

    const result = handleUrlPush({ url: "http://localhost:8080/approve?token=abc" }, deps);

    expect(result.success).toBe(true);
    expect(result.url).toBe("http://localhost:8080/approve?token=abc");
    expect(result.error).toBeUndefined();

    const event = getEvent();
    expect(event.type).toBe("url_push");
    expect(event.url).toBe("http://localhost:8080/approve?token=abc");
    expect(event.label).toBeNull();
    expect(event.sessionId).toBeNull();
  });

  it("successfully pushes an https URL", () => {
    const { deps, getEvent } = captureBroadcast();

    const result = handleUrlPush({ url: "https://example.com/page" }, deps);

    expect(result.success).toBe(true);

    const event = getEvent();
    expect(event.url).toBe("https://example.com/page");
  });

  it("passes label through to SSE event", () => {
    const { deps, getEvent } = captureBroadcast();

    handleUrlPush({ url: "https://example.com", label: "Approve JIT access" }, deps);

    expect(getEvent().label).toBe("Approve JIT access");
  });

  it("passes sessionId through to SSE event", () => {
    const { deps, getEvent } = captureBroadcast();

    handleUrlPush({ url: "https://example.com", sessionId: "pane-42" }, deps);

    expect(getEvent().sessionId).toBe("pane-42");
  });

  it("does not broadcast when URL is invalid", () => {
    let broadcastCalled = false;
    const deps = createMockDeps({
      broadcastUrlPush: () => {
        broadcastCalled = true;
      },
    });

    handleUrlPush({ url: "not-a-url" }, deps);
    expect(broadcastCalled).toBe(false);
  });
});
