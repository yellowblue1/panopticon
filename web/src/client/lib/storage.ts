const DB_NAME = "panopticon";
const STORE_NAME = "read-events";

let db: IDBDatabase | null = null;

export async function initDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    request.onupgradeneeded = (event) => {
      const target = event.target as IDBOpenDBRequest;
      const database = target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
  });
}

export async function getReadStatus(sessionId: string): Promise<boolean> {
  const database = db;
  if (!database) return false;
  return new Promise((resolve) => {
    const tx = database.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(sessionId);
    request.onsuccess = () => resolve(!!request.result);
    request.onerror = () => resolve(false);
  });
}

export async function setReadStatus(sessionId: string, isRead: boolean): Promise<void> {
  const database = db;
  if (!database) return;
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    if (isRead) {
      store.put(true, sessionId);
    } else {
      store.delete(sessionId);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
