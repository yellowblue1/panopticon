import { useCallback, useEffect, useState } from "react";
import { getReadStatus, initDb, setReadStatus } from "@/lib/storage";

export function useReadStatus(paneIds: string[]) {
  const [readStatuses, setReadStatuses] = useState<Map<string, boolean>>(new Map());
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    initDb().then(() => {
      setDbReady(true);
    });
  }, []);

  useEffect(() => {
    if (!dbReady || paneIds.length === 0) return;

    Promise.all(paneIds.map((id) => getReadStatus(id))).then((statuses) => {
      const map = new Map<string, boolean>();
      for (let i = 0; i < paneIds.length; i++) {
        map.set(paneIds[i], statuses[i]);
      }
      setReadStatuses(map);
    });
  }, [dbReady, paneIds]);

  const markAsRead = useCallback(async (paneId: string) => {
    await setReadStatus(paneId, true);
    setReadStatuses((prev) => {
      const next = new Map(prev);
      next.set(paneId, true);
      return next;
    });
  }, []);

  const markAsUnread = useCallback(async (paneId: string) => {
    await setReadStatus(paneId, false);
    setReadStatuses((prev) => {
      const next = new Map(prev);
      next.set(paneId, false);
      return next;
    });
  }, []);

  return { readStatuses, markAsRead, markAsUnread };
}
