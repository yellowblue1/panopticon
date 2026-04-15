import type { FilePushSseEvent, SessionsApiResponse, UrlPushSseEvent } from "@shared/types";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useConnection } from "@/contexts/connection-context";
import { useReadStatusContext } from "@/contexts/read-status-context";
import { hashContent } from "@/lib/hash-content";
import { clearNotificationTracking, showBrowserNotification } from "@/lib/notifications";
import { authKeys, sessionKeys } from "@/lib/query-keys";
import { hasSessionsChanged } from "@/lib/sessions-changed";
import { fetchSessions } from "./use-sessions";

const POLL_INTERVAL_MS = 5000;
const RECONNECT_TIMEOUT_MS = 30000;

// Staleness detection: if no SSE message (data or heartbeat) arrives within
// this threshold, the connection is considered dead and will be reconnected.
// Must be > server heartbeat interval (30s) to avoid false positives.
const SSE_STALENESS_THRESHOLD_MS = 45_000;
const STALENESS_CHECK_INTERVAL_MS = 15_000;

interface PreviousSessionState {
  status: string;
  summaryHash: string;
}

interface SessionsStreamCallbacks {
  onFilePush?: (event: FilePushSseEvent) => void;
  onUrlPush?: (event: UrlPushSseEvent) => void;
}

export function useSessionsStream(callbacks?: SessionsStreamCallbacks): void {
  const { onFilePush, onUrlPush } = callbacks ?? {};
  const queryClient = useQueryClient();
  const { setStatus } = useConnection();
  const { batchMarkAsUnread } = useReadStatusContext();
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stalenessCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMessageRef = useRef<number>(Date.now());
  const previousStatesRef = useRef(new Map<string, PreviousSessionState>());

  const handleSessionsUpdate = async (data: SessionsApiResponse) => {
    const previousStates = previousStatesRef.current;
    const currentPaneIds = new Set<string>();
    const changedPaneIds: string[] = [];

    for (const session of data.sessions) {
      currentPaneIds.add(session.pane_id);
      const prevState = previousStates.get(session.pane_id);
      const currentSummaryHash = hashContent(session.summary ?? "");

      if (prevState) {
        const statusChanged = session.status !== prevState.status;
        const summaryChanged =
          currentSummaryHash !== "" && currentSummaryHash !== prevState.summaryHash;

        if (statusChanged || summaryChanged) {
          changedPaneIds.push(session.pane_id);
        }
      }

      if (session.status === "waiting" && prevState?.status !== "waiting") {
        showBrowserNotification(session);
      }

      if (session.status === "busy" && prevState?.status === "waiting") {
        clearNotificationTracking(session.pane_id);
      }

      previousStates.set(session.pane_id, {
        status: session.status,
        summaryHash: currentSummaryHash,
      });
    }

    for (const paneId of previousStates.keys()) {
      if (!currentPaneIds.has(paneId)) {
        previousStates.delete(paneId);
        clearNotificationTracking(paneId);
      }
    }

    if (changedPaneIds.length > 0) {
      await batchMarkAsUnread(changedPaneIds);
    }

    // Only update cache when rendering-relevant fields changed to avoid
    // unnecessary re-renders that reset scroll position (see #92).
    const currentData = queryClient.getQueryData<SessionsApiResponse>(sessionKeys.lists());
    if (!currentData || hasSessionsChanged(currentData, data)) {
      queryClient.setQueryData<SessionsApiResponse>(sessionKeys.lists(), data);
    }
    // Invalidate auth status to pick up runtime auth error changes
    queryClient.invalidateQueries({ queryKey: authKeys.status() });
  };

  const pollSessions = async () => {
    try {
      const data = await fetchSessions();
      await handleSessionsUpdate(data);
    } catch {
      // Polling error, will retry on next interval
    }
  };

  const clearStalenessCheck = () => {
    if (stalenessCheckRef.current) {
      clearInterval(stalenessCheckRef.current);
      stalenessCheckRef.current = null;
    }
  };

  const connectSSE = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    clearStalenessCheck();

    const es = new EventSource("/api/sessions/stream");
    eventSourceRef.current = es;

    es.onopen = () => {
      setStatus("connected");
      lastMessageRef.current = Date.now();
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }

      // Start staleness monitoring — reconnect if no messages arrive
      clearStalenessCheck();
      stalenessCheckRef.current = setInterval(() => {
        if (Date.now() - lastMessageRef.current > SSE_STALENESS_THRESHOLD_MS) {
          if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
          }
          clearStalenessCheck();
          connectSSE();
        }
      }, STALENESS_CHECK_INTERVAL_MS);
    };

    es.onmessage = (event) => {
      lastMessageRef.current = Date.now();
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.type === "heartbeat") return;
        if (parsed.type === "file_push") {
          onFilePush?.(parsed as FilePushSseEvent);
          return;
        }
        if (parsed.type === "url_push") {
          onUrlPush?.(parsed as UrlPushSseEvent);
          return;
        }
        handleSessionsUpdate(parsed as SessionsApiResponse);
      } catch (err) {
        console.warn("Failed to parse SSE message:", err);
      }
    };

    es.onerror = () => {
      setStatus("disconnected");
      clearStalenessCheck();
      if (es) {
        es.close();
        eventSourceRef.current = null;
      }

      if (!pollTimerRef.current) {
        setStatus("polling");
        pollTimerRef.current = setInterval(pollSessions, POLL_INTERVAL_MS);
        pollSessions();
      }

      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => {
        if (pollTimerRef.current) {
          connectSSE();
        }
      }, RECONNECT_TIMEOUT_MS);
    };
  };

  useEffect(() => {
    connectSSE();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      clearStalenessCheck();
    };
  }, [connectSSE, clearStalenessCheck]);
}
