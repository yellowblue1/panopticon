import { computeLineDiff, isDiffWorthSending } from "../src/shared/pane-diff";
import type { PaneContentFull, PaneContentMessage } from "../src/shared/types";
import type { SseClient } from "./server-app";

const UPDATE_INTERVAL_MS = 75;
const FULL_SYNC_INTERVAL = 20;

interface PaneState {
  clients: Set<SseClient>;
  content: string | null;
  seq: number;
  updates: number;
  timer?: ReturnType<typeof setTimeout>;
}

/** Owns the snapshot used by every watcher, including newly connected clients. */
export function createPaneContentStream(capture: (paneId: string) => string | null) {
  const panes = new Map<string, PaneState>();
  const encoder = new TextEncoder();

  function full(paneId: string, state: PaneState): PaneContentFull {
    return {
      type: "full",
      pane_id: paneId,
      content: state.content,
      seq: state.seq,
      timestamp: Date.now(),
    };
  }

  function broadcast(state: PaneState, message: PaneContentMessage) {
    const bytes = encoder.encode(`data: ${JSON.stringify(message)}\n\n`);
    for (const client of state.clients) {
      try {
        client.controller.enqueue(bytes);
      } catch {
        state.clients.delete(client);
      }
    }
  }

  return {
    onActivity(paneId: string) {
      const state = panes.get(paneId);
      // Throttle: continuous output must not postpone the pending capture.
      if (!state || state.clients.size === 0 || state.timer !== undefined) return;
      state.timer = setTimeout(() => {
        state.timer = undefined;
        const content = capture(paneId);
        if (content === null || content === state.content) return;
        const previous = state.content;
        state.content = content;
        state.seq++;
        state.updates++;
        const diff = previous === null ? null : computeLineDiff(previous, content);
        if (
          state.updates % FULL_SYNC_INTERVAL !== 0 &&
          diff &&
          isDiffWorthSending(content.length, diff.lines)
        ) {
          broadcast(state, {
            type: "diff",
            pane_id: paneId,
            ...diff,
            seq: state.seq,
            timestamp: Date.now(),
          });
        } else {
          broadcast(state, full(paneId, state));
        }
      }, UPDATE_INTERVAL_MS);
    },
    onConnect(paneId: string, client: SseClient): PaneContentFull {
      let state = panes.get(paneId);
      const content = capture(paneId);
      if (!state) {
        state = { clients: new Set(), content, seq: 0, updates: 0 };
        panes.set(paneId, state);
      } else if (content !== null && content !== state.content) {
        // A new capture must reach existing watchers before becoming the diff baseline.
        state.content = content;
        state.seq++;
        state.updates = 0;
        broadcast(state, full(paneId, state));
      }
      state.clients.add(client);
      // The route sends this exact snapshot; never capture a second time there.
      return full(paneId, state);
    },
    onDisconnect(paneId: string, client: SseClient) {
      const state = panes.get(paneId);
      if (!state) return;
      state.clients.delete(client);
      if (state.clients.size === 0) {
        clearTimeout(state.timer);
        panes.delete(paneId);
      }
    },
  };
}
