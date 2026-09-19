import { describe, expect, it } from "bun:test";
import { applyLineDiff } from "../src/shared/pane-diff";
import type { PaneContentMessage } from "../src/shared/types";
import { createPaneContentStream } from "./pane-content-stream";
import { createApp, type SseClient } from "./server-app";

function watcher() {
  const messages: PaneContentMessage[] = [];
  let content = "";
  const client: SseClient = {
    controller: {
      desiredSize: 1,
      close() {},
      error() {},
      enqueue(chunk: Uint8Array) {
        const message: PaneContentMessage = JSON.parse(new TextDecoder().decode(chunk).slice(6));
        messages.push(message);
        content =
          message.type === "full" ? (message.content ?? "") : applyLineDiff(content, message);
      },
    },
  };
  return {
    client,
    messages,
    get content() {
      return content;
    },
    set content(value: string) {
      content = value;
    },
  };
}

describe("pane content streaming", () => {
  it("updates during continuous terminal output", async () => {
    let content = "initial";
    const stream = createPaneContentStream(() => content);
    const w = watcher();
    stream.onConnect("%0", w.client);
    try {
      for (let i = 0; i < 12; i++) {
        content = `frame ${i}`;
        stream.onActivity("%0");
        await Bun.sleep(20);
      }
      expect(w.messages.length).toBeGreaterThan(0);
    } finally {
      stream.onDisconnect("%0", w.client);
    }
  });

  it("keeps existing watchers in sync when another watcher connects between frames", async () => {
    const padding = "unchanged line\n".repeat(100);
    let content = `${padding}old\nlast`;
    const stream = createPaneContentStream(() => content);
    const first = watcher();
    const second = watcher();
    stream.onConnect("%0", first.client);
    first.content = content;
    content = `${padding}new\nlast`;
    stream.onConnect("%0", second.client);
    second.content = content;
    content = `${padding}new\nupdated`;
    stream.onActivity("%0");
    await Bun.sleep(110);
    try {
      expect(first.content).toBe(content);
      expect(second.content).toBe(content);
    } finally {
      stream.onDisconnect("%0", first.client);
      stream.onDisconnect("%0", second.client);
    }
  });
});

describe("pane stream HTTP integration", () => {
  it("sends the exact shared baseline without a second capture and preserves its sequence", async () => {
    let captures = 0;
    const capture = () => `frame ${++captures}`;
    const stream = createPaneContentStream(capture);
    const app = createApp({
      getSessions: () => [],
      capturePaneContent: capture,
      onPaneContentSseConnect: stream.onConnect,
      onPaneContentSseDisconnect: stream.onDisconnect,
    });
    const first = (await app.request("/api/sessions/%250/pane-content/stream")).body?.getReader();
    if (!first) throw new Error("Missing first response body");
    const read = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
      const { value } = await reader.read();
      return JSON.parse(new TextDecoder().decode(value).slice(6));
    };
    expect(await read(first)).toMatchObject({ type: "full", content: "frame 1", seq: 0 });
    const second = (await app.request("/api/sessions/%250/pane-content/stream")).body?.getReader();
    if (!second) throw new Error("Missing second response body");
    try {
      expect(await read(second)).toMatchObject({ type: "full", content: "frame 2", seq: 1 });
      expect(await read(first)).toMatchObject({ type: "full", content: "frame 2", seq: 1 });
      expect(captures).toBe(2);
    } finally {
      await first.cancel();
      await second.cancel();
    }
  });
});
