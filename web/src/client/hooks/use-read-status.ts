import { useEffect, useMemo } from "react";
import { useReadStatusContext } from "@/contexts/read-status-context";

interface ReadStatusResult {
  readStatuses: Map<string, boolean>;
  lastSeenMap: Map<string, number>;
  markAsRead: (paneId: string) => Promise<void>;
  markAsUnread: (paneId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
}

export function useReadStatus(paneIds: string[]): ReadStatusResult {
  const { snapshots, markAsRead, markAsUnread, markAllAsRead, loadSnapshots } =
    useReadStatusContext();

  useEffect(() => {
    loadSnapshots(paneIds);
  }, [paneIds, loadSnapshots]);

  const readStatuses = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const [id, snapshot] of snapshots) {
      map.set(id, snapshot.isRead);
    }
    return map;
  }, [snapshots]);

  const lastSeenMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const [id, snapshot] of snapshots) {
      map.set(id, snapshot.lastSeenAt);
    }
    return map;
  }, [snapshots]);

  const boundMarkAllAsRead = useMemo(() => () => markAllAsRead(paneIds), [markAllAsRead, paneIds]);

  return { readStatuses, lastSeenMap, markAsRead, markAsUnread, markAllAsRead: boundMarkAllAsRead };
}
