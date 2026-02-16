import { useEffect } from "react";
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

  const readStatuses = new Map<string, boolean>();
  for (const [id, snapshot] of snapshots) {
    readStatuses.set(id, snapshot.isRead);
  }

  const lastSeenMap = new Map<string, number>();
  for (const [id, snapshot] of snapshots) {
    lastSeenMap.set(id, snapshot.lastSeenAt);
  }

  const boundMarkAllAsRead = () => markAllAsRead(paneIds);

  return { readStatuses, lastSeenMap, markAsRead, markAsUnread, markAllAsRead: boundMarkAllAsRead };
}
