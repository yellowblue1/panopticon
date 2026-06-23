import { applyLineDiff } from "@shared/pane-diff";
import type { PaneContentMessage, PaneContentResponse } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { sessionsApi } from "@/lib/rpc-client";

const POLL_FALLBACK_INTERVAL = 2000;

// Staleness detection: if no SSE message (data or heartbeat) arrives within
// this threshold, treat the connection as dead and reconnect. Must exceed the
// server heartbeat interval (30s) to avoid false positives.
const SSE_STALENESS_THRESHOLD_MS = 45_000;
const STALENESS_CHECK_INTERVAL_MS = 15_000;

const fetchPaneContent = async (paneId: string): Promise<PaneContentResponse> => {
  const res = await sessionsApi[":pane_id"]["pane-content"].$get({
    param: { pane_id: encodeURIComponent(paneId) },
  });
  if (!res.ok) throw new Error("Failed to fetch pane content");
  return await res.json();
};

export function usePaneContent(paneId: string) {
  const [data, setData] = useState<PaneContentResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stalenessTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMessageRef = useRef<number>(Date.now());

  // Track current content for diff application
  const contentRef = useRef<string | null>(null);

  const startPolling = useCallback(() => {
    if (pollTimerRef.current) return;
    const poll = async () => {
      try {
        const result = await fetchPaneContent(paneId);
        contentRef.current = result.content;
        setData(result);
        setIsLoading(false);
        setError(null);
      } catch (err) {
        setError(err as Error);
      }
    };
    poll();
    pollTimerRef.current = setInterval(poll, POLL_FALLBACK_INTERVAL);
  }, [paneId]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    contentRef.current = null;
    lastMessageRef.current = Date.now();

    const encodedPaneId = encodeURIComponent(paneId);

    const handleMessage = (event: MessageEvent) => {
      lastMessageRef.current = Date.now();
      try {
        const parsed = JSON.parse(event.data) as PaneContentMessage | { type: "heartbeat" };

        if (parsed.type === "heartbeat") return;

        if (parsed.type === "full") {
          contentRef.current = parsed.content;
          setData({
            pane_id: parsed.pane_id,
            content: parsed.content,
            timestamp: parsed.timestamp,
          });
        } else if (parsed.type === "diff") {
          if (contentRef.current === null) return;
          const newContent = applyLineDiff(contentRef.current, {
            lines: parsed.lines,
            lineCount: parsed.lineCount,
          });
          contentRef.current = newContent;
          setData({
            pane_id: parsed.pane_id,
            content: newContent,
            timestamp: parsed.timestamp,
          });
        }

        setIsLoading(false);
        setError(null);
      } catch {
        // Ignore malformed messages
      }
    };

    const connect = (): EventSource => {
      const source = new EventSource(`/api/sessions/${encodedPaneId}/pane-content/stream`);
      lastMessageRef.current = Date.now();
      source.onmessage = handleMessage;
      source.onerror = () => {
        source.close();
        if (eventSourceRef.current === source) {
          eventSourceRef.current = null;
        }
        startPolling();
      };
      eventSourceRef.current = source;
      return source;
    };

    connect();

    // Staleness watchdog: if SSE stays connected but stops emitting (data or
    // heartbeat), the underlying pipe-pane likely died. Reconnect to re-trigger
    // initial-content capture on the server, then fall back to polling on error.
    stalenessTimerRef.current = setInterval(() => {
      if (!eventSourceRef.current) return;
      const elapsed = Date.now() - lastMessageRef.current;
      if (elapsed < SSE_STALENESS_THRESHOLD_MS) return;

      const stale = eventSourceRef.current;
      stale.close();
      eventSourceRef.current = null;
      connect();
    }, STALENESS_CHECK_INTERVAL_MS);

    return () => {
      if (stalenessTimerRef.current) {
        clearInterval(stalenessTimerRef.current);
        stalenessTimerRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      stopPolling();
    };
  }, [paneId, startPolling, stopPolling]);

  return { data, isLoading, error };
}
