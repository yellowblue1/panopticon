import type { PaneContentResponse } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { sessionsApi } from "@/lib/rpc-client";

const POLL_FALLBACK_INTERVAL = 2000;

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

  const startPolling = useCallback(() => {
    if (pollTimerRef.current) return;
    const poll = async () => {
      try {
        const result = await fetchPaneContent(paneId);
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
    const encodedPaneId = encodeURIComponent(paneId);
    const es = new EventSource(`/api/sessions/${encodedPaneId}/pane-content/stream`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const parsed: PaneContentResponse = JSON.parse(event.data);
        setData(parsed);
        setIsLoading(false);
        setError(null);
      } catch {
        // Ignore malformed messages
      }
    };

    es.onerror = () => {
      // SSE failed — close and fall back to polling
      es.close();
      eventSourceRef.current = null;
      startPolling();
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
      stopPolling();
    };
  }, [paneId, startPolling, stopPolling]);

  return { data, isLoading, error };
}
