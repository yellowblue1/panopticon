import type { SessionsApiResponse } from "@shared/types";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { useConnection } from "@/contexts/connection-context";
import { useNotifications } from "@/contexts/notification-context";
import { clearNotificationTracking, showBrowserNotification } from "@/lib/notifications";
import { authKeys, sessionKeys } from "@/lib/query-keys";
import { setReadStatus } from "@/lib/storage";
import { fetchSessions } from "./use-sessions";

const POLL_INTERVAL_MS = 5000;
const RECONNECT_TIMEOUT_MS = 30000;

// Staleness detection: if no SSE message (data or heartbeat) arrives within
// this threshold, the connection is considered dead and will be reconnected.
// Must be > server heartbeat interval (30s) to avoid false positives.
const SSE_STALENESS_THRESHOLD_MS = 45_000;
const STALENESS_CHECK_INTERVAL_MS = 15_000;

export function useSessionsStream(): void {
  const queryClient = useQueryClient();
  const { setStatus } = useConnection();
  const { addNotification } = useNotifications();
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stalenessCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMessageRef = useRef<number>(Date.now());
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
          addNotification({
            paneId: session.pane_id,
            projectName: session.project_name,
            summary: session.summary,
          });
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
      // Invalidate auth status to pick up runtime auth error changes
      queryClient.invalidateQueries({ queryKey: authKeys.status() });
    },
    [queryClient, addNotification],
  );

  const pollSessions = useCallback(async () => {
    try {
      const data = await fetchSessions();
      await handleSessionsUpdate(data);
    } catch {
      // Polling error, will retry on next interval
    }
  }, [handleSessionsUpdate]);

  const clearStalenessCheck = useCallback(() => {
    if (stalenessCheckRef.current) {
      clearInterval(stalenessCheckRef.current);
      stalenessCheckRef.current = null;
    }
  }, []);

  const connectSSE = useCallback(() => {
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
  }, [setStatus, handleSessionsUpdate, pollSessions, clearStalenessCheck]);

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
