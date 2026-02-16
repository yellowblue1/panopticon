import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import type { SessionSnapshot } from "@/lib/storage";
import {
  batchMarkSnapshotsAsUnread,
  getSessionSnapshot,
  initDb,
  markAllSnapshotsAsRead,
  setSessionSnapshot,
} from "@/lib/storage";

interface ReadStatusContextValue {
  snapshots: Map<string, SessionSnapshot>;
  markAsRead: (paneId: string) => Promise<void>;
  markAsUnread: (paneId: string) => Promise<void>;
  batchMarkAsUnread: (paneIds: string[]) => Promise<void>;
  markAllAsRead: (paneIds: string[]) => Promise<void>;
  loadSnapshots: (paneIds: string[]) => Promise<void>;
}

const ReadStatusContext = createContext<ReadStatusContextValue | null>(null);

export function ReadStatusProvider({ children }: { children: ReactNode }) {
  const [snapshots, setSnapshots] = useState<Map<string, SessionSnapshot>>(new Map());
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    initDb().then(() => {
      setDbReady(true);
    });
  }, []);

  const loadSnapshots = async (paneIds: string[]) => {
    if (!dbReady || paneIds.length === 0) return;

    const results = await Promise.all(paneIds.map((id) => getSessionSnapshot(id)));
    setSnapshots((prev) => {
      const next = new Map(prev);
      for (let i = 0; i < paneIds.length; i++) {
        const snapshot = results[i];
        if (snapshot) {
          next.set(paneIds[i], snapshot);
        }
      }
      return next;
    });
  };

  const markAsRead = async (paneId: string) => {
    const now = Date.now();
    let snapshotToWrite: SessionSnapshot | undefined;
    setSnapshots((prev) => {
      const next = new Map(prev);
      const snapshot: SessionSnapshot = {
        paneId,
        isRead: true,
        lastSeenAt: now,
      };
      next.set(paneId, snapshot);
      snapshotToWrite = snapshot;
      return next;
    });
    if (snapshotToWrite) {
      await setSessionSnapshot(snapshotToWrite);
    }
  };

  const markAsUnread = async (paneId: string) => {
    let snapshotToWrite: SessionSnapshot | undefined;
    setSnapshots((prev) => {
      const next = new Map(prev);
      const existing = prev.get(paneId);
      const snapshot: SessionSnapshot = {
        paneId,
        isRead: false,
        lastSeenAt: existing?.lastSeenAt ?? 0,
      };
      next.set(paneId, snapshot);
      snapshotToWrite = snapshot;
      return next;
    });
    if (snapshotToWrite) {
      await setSessionSnapshot(snapshotToWrite);
    }
  };

  const batchMarkAsUnread = async (paneIds: string[]) => {
    if (paneIds.length === 0) return;
    setSnapshots((prev) => {
      const next = new Map(prev);
      for (const paneId of paneIds) {
        const existing = prev.get(paneId);
        next.set(paneId, {
          paneId,
          isRead: false,
          lastSeenAt: existing?.lastSeenAt ?? 0,
        });
      }
      return next;
    });
    await batchMarkSnapshotsAsUnread(paneIds);
  };

  const markAllAsRead = async (paneIds: string[]) => {
    const now = Date.now();
    let allIds: string[] = [];
    setSnapshots((prev) => {
      const next = new Map(prev);
      allIds = [...new Set([...prev.keys(), ...paneIds])];
      for (const id of allIds) {
        next.set(id, {
          paneId: id,
          isRead: true,
          lastSeenAt: now,
        });
      }
      return next;
    });
    await markAllSnapshotsAsRead(allIds);
  };

  const value = {
    snapshots,
    markAsRead,
    markAsUnread,
    batchMarkAsUnread,
    markAllAsRead,
    loadSnapshots,
  };

  return <ReadStatusContext.Provider value={value}>{children}</ReadStatusContext.Provider>;
}

export function useReadStatusContext(): ReadStatusContextValue {
  const context = useContext(ReadStatusContext);
  if (!context) {
    throw new Error("useReadStatusContext must be used within a ReadStatusProvider");
  }
  return context;
}
