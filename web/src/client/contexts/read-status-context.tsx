import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { SessionSnapshot } from "@/lib/storage";
import {
  getSessionSnapshot,
  initDb,
  markAllSnapshotsAsRead,
  setSessionSnapshot,
} from "@/lib/storage";

interface ReadStatusContextValue {
  snapshots: Map<string, SessionSnapshot>;
  markAsRead: (paneId: string) => Promise<void>;
  markAsUnread: (paneId: string) => Promise<void>;
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

  const loadSnapshots = useCallback(
    async (paneIds: string[]) => {
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
    },
    [dbReady],
  );

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

  const markAllAsRead = useCallback(
    async (paneIds: string[]) => {
      const now = Date.now();
      setSnapshots((prev) => {
        const next = new Map(prev);
        const allIds = [...new Set([...prev.keys(), ...paneIds])];
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
      const allIds = [...new Set([...snapshots.keys(), ...paneIds])];
      await markAllSnapshotsAsRead(allIds);
    },
    [snapshots],
  );

  const value = useMemo(
    () => ({ snapshots, markAsRead, markAsUnread, markAllAsRead, loadSnapshots }),
    [snapshots, markAsRead, markAsUnread, markAllAsRead, loadSnapshots],
  );

  return <ReadStatusContext.Provider value={value}>{children}</ReadStatusContext.Provider>;
}

export function useReadStatusContext(): ReadStatusContextValue {
  const context = useContext(ReadStatusContext);
  if (!context) {
    throw new Error("useReadStatusContext must be used within a ReadStatusProvider");
  }
  return context;
}
