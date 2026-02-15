import { useCallback, useEffect, useState } from "react";
import type { SessionSnapshot } from "@/lib/storage";
import {
  getSessionSnapshot,
  initDb,
  markAllSnapshotsAsRead,
  setSessionSnapshot,
} from "@/lib/storage";

interface ReadStatusResult {
  readStatuses: Map<string, boolean>;
  lastSeenMap: Map<string, number>;
  markAsRead: (paneId: string) => Promise<void>;
  markAsUnread: (paneId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
}

export function useReadStatus(paneIds: string[]): ReadStatusResult {
  const [snapshots, setSnapshots] = useState<Map<string, SessionSnapshot>>(new Map());
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    initDb().then(() => {
      setDbReady(true);
    });
  }, []);

  useEffect(() => {
    if (!dbReady || paneIds.length === 0) return;

    Promise.all(paneIds.map((id) => getSessionSnapshot(id))).then((results) => {
      const map = new Map<string, SessionSnapshot>();
      for (let i = 0; i < paneIds.length; i++) {
        const snapshot = results[i];
        if (snapshot) {
          map.set(paneIds[i], snapshot);
        }
      }
      setSnapshots(map);
    });
  }, [dbReady, paneIds]);

  const markAsRead = useCallback(async (paneId: string) => {
    const now = Date.now();
    setSnapshots((prev) => {
      const next = new Map(prev);
      const existing = prev.get(paneId);
      next.set(paneId, {
        paneId,
        isRead: true,
        lastSeenAt: now,
        contentHash: existing?.contentHash ?? "",
        lastStatus: existing?.lastStatus ?? "",
      });
      return next;
    });
    const existing = await getSessionSnapshot(paneId);
    await setSessionSnapshot({
      paneId,
      isRead: true,
      lastSeenAt: now,
      contentHash: existing?.contentHash ?? "",
      lastStatus: existing?.lastStatus ?? "",
    });
  }, []);

  const markAsUnread = useCallback(async (paneId: string) => {
    setSnapshots((prev) => {
      const next = new Map(prev);
      const existing = prev.get(paneId);
      next.set(paneId, {
        paneId,
        isRead: false,
        lastSeenAt: existing?.lastSeenAt ?? 0,
        contentHash: existing?.contentHash ?? "",
        lastStatus: existing?.lastStatus ?? "",
      });
      return next;
    });
    const existing = await getSessionSnapshot(paneId);
    await setSessionSnapshot({
      paneId,
      isRead: false,
      lastSeenAt: existing?.lastSeenAt ?? 0,
      contentHash: existing?.contentHash ?? "",
      lastStatus: existing?.lastStatus ?? "",
    });
  }, []);

  const markAllAsRead = useCallback(async () => {
    const ids = [...snapshots.keys()];
    // Also include pane IDs that have no snapshot yet (new sessions)
    const allIds = [...new Set([...ids, ...paneIds])];
    const now = Date.now();
    setSnapshots((prev) => {
      const next = new Map(prev);
      for (const id of allIds) {
        const existing = prev.get(id);
        next.set(id, {
          paneId: id,
          isRead: true,
          lastSeenAt: now,
          contentHash: existing?.contentHash ?? "",
          lastStatus: existing?.lastStatus ?? "",
        });
      }
      return next;
    });
    await markAllSnapshotsAsRead(allIds);
  }, [snapshots, paneIds]);

  const readStatuses = new Map<string, boolean>();
  const lastSeenMap = new Map<string, number>();
  for (const [id, snapshot] of snapshots) {
    readStatuses.set(id, snapshot.isRead);
    lastSeenMap.set(id, snapshot.lastSeenAt);
  }

  return { readStatuses, lastSeenMap, markAsRead, markAsUnread, markAllAsRead };
}
