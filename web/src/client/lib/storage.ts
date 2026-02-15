const DB_NAME = "panopticon";
const DB_VERSION = 2;
const LEGACY_STORE = "read-events";
const SNAPSHOT_STORE = "session-snapshots";

export interface SessionSnapshot {
  paneId: string;
  isRead: boolean;
  lastSeenAt: number;
  contentHash: string;
  lastStatus: string;
}

let db: IDBDatabase | null = null;

export async function initDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    request.onupgradeneeded = (event) => {
      const target = event.target as IDBOpenDBRequest;
      const database = target.result;

      // v0 → v1: create legacy read-events store
      if (event.oldVersion < 1) {
        database.createObjectStore(LEGACY_STORE);
      }

      // v1 → v2: create session-snapshots store, migrate legacy data
      if (event.oldVersion < 2) {
        const snapshotStore = database.createObjectStore(SNAPSHOT_STORE, {
          keyPath: "paneId",
        });

        if (database.objectStoreNames.contains(LEGACY_STORE) && target.transaction) {
          const oldStore = target.transaction.objectStore(LEGACY_STORE);
          const cursorReq = oldStore.openCursor();
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (cursor) {
              snapshotStore.put({
                paneId: cursor.key as string,
                isRead: true,
                lastSeenAt: Date.now(),
                contentHash: "",
                lastStatus: "",
              } satisfies SessionSnapshot);
              cursor.continue();
            }
          };
        }
      }
    };
  });
}

export async function getSessionSnapshot(paneId: string): Promise<SessionSnapshot | null> {
  const database = db;
  if (!database) return null;
  return new Promise((resolve) => {
    const tx = database.transaction(SNAPSHOT_STORE, "readonly");
    const store = tx.objectStore(SNAPSHOT_STORE);
    const request = store.get(paneId);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => resolve(null);
  });
}

export async function setSessionSnapshot(snapshot: SessionSnapshot): Promise<void> {
  const database = db;
  if (!database) return;
  return new Promise((resolve, reject) => {
    const tx = database.transaction(SNAPSHOT_STORE, "readwrite");
    const store = tx.objectStore(SNAPSHOT_STORE);
    store.put(snapshot);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function markAllSnapshotsAsRead(paneIds: string[]): Promise<void> {
  const database = db;
  if (!database) return;
  return new Promise((resolve, reject) => {
    const tx = database.transaction(SNAPSHOT_STORE, "readwrite");
    const store = tx.objectStore(SNAPSHOT_STORE);
    const now = Date.now();
    for (const paneId of paneIds) {
      const getReq = store.get(paneId);
      getReq.onsuccess = () => {
        const existing: SessionSnapshot | undefined = getReq.result;
        store.put({
          paneId,
          isRead: true,
          lastSeenAt: now,
          contentHash: existing?.contentHash ?? "",
          lastStatus: existing?.lastStatus ?? "",
        } satisfies SessionSnapshot);
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
