import type { SessionsApiResponse } from "@shared/types";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { useConnection } from "@/contexts/connection-context";
import { clearNotificationTracking, showBrowserNotification } from "@/lib/notifications";
import { sessionKeys } from "@/lib/query-keys";
import { setReadStatus } from "@/lib/storage";
import { fetchSessions } from "./use-sessions";

const POLL_INTERVAL_MS = 5000;
const RECONNECT_TIMEOUT_MS = 30000;

export function useSessionsStream(): void {
  const queryClient = useQueryClient();
  const { setStatus } = useConnection();
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousStatusesRef = useRef(new Map<string, string>());

  const handleSessionsUpdate = useCallback(
    async (data: SessionsApiResponse) => {
      const previousStatuses = previousStatusesRef.current;
      const currentPaneIds = new Set<string>();

      for (const session of data.sessions) {
        currentPaneIds.add(session.pane_id);
        const prevStatus = previousStatuses.get(session.pane_id);

        if (session.status === "waiting" && prevStatus !== "waiting") {
          showBrowserNotification(session);
          await setReadStatus(session.pane_id, false);
        }

        if (session.status === "busy" && prevStatus === "waiting") {
          clearNotificationTracking(session.pane_id);
        }

        previousStatuses.set(session.pane_id, session.status);
      }

      for (const paneId of previousStatuses.keys()) {
        if (!currentPaneIds.has(paneId)) {
          previousStatuses.delete(paneId);
          clearNotificationTracking(paneId);
        }
      }

      queryClient.setQueryData<SessionsApiResponse>(sessionKeys.lists(), data);
    },
    [queryClient],
  );

  const pollSessions = useCallback(async () => {
    try {
      const data = await fetchSessions();
      await handleSessionsUpdate(data);
    } catch {
      // Polling error, will retry on next interval
    }
  }, [handleSessionsUpdate]);

  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource("/api/sessions/stream");
    eventSourceRef.current = es;

    es.onopen = () => {
      setStatus("connected");
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };

    es.onmessage = (event) => {
      try {
        const data: SessionsApiResponse = JSON.parse(event.data);
        handleSessionsUpdate(data);
      } catch (err) {
        console.warn("Failed to parse SSE message:", err);
      }
    };

    es.onerror = () => {
      setStatus("disconnected");
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
  }, [setStatus, handleSessionsUpdate, pollSessions]);

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
    };
  }, [connectSSE]);
}
