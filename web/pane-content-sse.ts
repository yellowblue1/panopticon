/**
 * Pure-function core of the pane-content SSE connect handler.
 *
 * Extracted from server.ts so the multi-watcher baseline invariants — first
 * watcher seeds paneContentPrev / paneContentHashes from a single capture,
 * later watchers must reuse those — can be tested without the side-effecting
 * tmux runtime in server.ts.
 *
 * The handler mutates the four state maps in place; the caller passes a
 * `capture` thunk so tests can supply deterministic snapshots.
 */
export interface PaneContentSseConnectState {
  paneContentClients: Map<string, Set<unknown>>;
  paneContentPrev: Map<string, string>;
  paneContentHashes: Map<string, string>;
  paneContentSeq: Map<string, number>;
}

export interface PaneContentSseConnectResult {
  content: string | null;
  seq: number;
}

export function handlePaneContentSseConnect(
  paneId: string,
  client: unknown,
  state: PaneContentSseConnectState,
  capture: () => string | null,
  hash: (s: string) => string,
): PaneContentSseConnectResult {
  const isFirstWatcher = !state.paneContentClients.has(paneId);
  if (isFirstWatcher) {
    state.paneContentClients.set(paneId, new Set());
  }
  state.paneContentClients.get(paneId)?.add(client);

  if (isFirstWatcher) {
    const initialContent = capture();
    if (initialContent !== null) {
      state.paneContentPrev.set(paneId, initialContent);
      state.paneContentHashes.set(paneId, hash(initialContent));
    }
    return { content: initialContent, seq: state.paneContentSeq.get(paneId) ?? 0 };
  }

  // Late watcher: prefer the existing baseline. If the first watcher's
  // capture failed and never seeded one, fall back to a fresh capture and
  // seed it now so subsequent diffs apply against a known baseline.
  let content = state.paneContentPrev.get(paneId) ?? null;
  if (content === null) {
    content = capture();
    if (content !== null) {
      state.paneContentPrev.set(paneId, content);
      state.paneContentHashes.set(paneId, hash(content));
    }
  }
  return { content, seq: state.paneContentSeq.get(paneId) ?? 0 };
}
