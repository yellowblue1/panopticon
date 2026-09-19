import { describe, expect, it } from "bun:test";
import { handlePaneContentSseConnect, type PaneContentSseConnectState } from "./pane-content-sse";

function makeState(): PaneContentSseConnectState {
  return {
    paneContentClients: new Map(),
    paneContentPrev: new Map(),
    paneContentHashes: new Map(),
    paneContentSeq: new Map(),
  };
}

const fakeHash = (s: string) => `hash:${s.length}`;

describe("handlePaneContentSseConnect", () => {
  it("captures once and seeds baseline + hash for the first watcher", () => {
    const state = makeState();
    let captureCalls = 0;
    const result = handlePaneContentSseConnect(
      "%1",
      { id: "A" },
      state,
      () => {
        captureCalls++;
        return "snapshot-1";
      },
      fakeHash,
    );
    expect(captureCalls).toBe(1);
    expect(result).toEqual({ content: "snapshot-1", seq: 0 });
    expect(state.paneContentPrev.get("%1")).toBe("snapshot-1");
    expect(state.paneContentHashes.get("%1")).toBe("hash:10");
    expect(state.paneContentClients.get("%1")?.size).toBe(1);
  });

  it("returns the existing baseline to a second watcher without re-capturing", () => {
    const state = makeState();
    state.paneContentPrev.set("%1", "baseline");
    state.paneContentClients.set("%1", new Set([{ id: "A" }]));
    state.paneContentSeq.set("%1", 7);

    let captureCalls = 0;
    const result = handlePaneContentSseConnect(
      "%1",
      { id: "B" },
      state,
      () => {
        captureCalls++;
        return "fresh-but-stale";
      },
      fakeHash,
    );

    expect(captureCalls).toBe(0);
    expect(result).toEqual({ content: "baseline", seq: 7 });
    expect(state.paneContentPrev.get("%1")).toBe("baseline");
    expect(state.paneContentClients.get("%1")?.size).toBe(2);
  });

  it("forwards the current paneContentSeq to late-joining watchers", () => {
    const state = makeState();
    state.paneContentPrev.set("%1", "baseline");
    state.paneContentClients.set("%1", new Set([{ id: "A" }]));
    state.paneContentSeq.set("%1", 42);

    const result = handlePaneContentSseConnect("%1", { id: "B" }, state, () => null, fakeHash);

    expect(result.seq).toBe(42);
  });

  it("falls back to capture for a late watcher when no baseline is recorded yet", () => {
    const state = makeState();
    state.paneContentClients.set("%1", new Set([{ id: "A" }]));
    state.paneContentSeq.set("%1", 3);

    const result = handlePaneContentSseConnect(
      "%1",
      { id: "B" },
      state,
      () => "fallback",
      fakeHash,
    );

    expect(result).toEqual({ content: "fallback", seq: 3 });
  });

  it("returns null content (and does not seed baseline) when first capture fails", () => {
    const state = makeState();
    const result = handlePaneContentSseConnect("%1", { id: "A" }, state, () => null, fakeHash);

    expect(result).toEqual({ content: null, seq: 0 });
    expect(state.paneContentPrev.has("%1")).toBe(false);
    expect(state.paneContentHashes.has("%1")).toBe(false);
  });
});
