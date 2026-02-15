// In-app notification store — pure functions over immutable state.
// No React dependency; independently testable.

export type NotificationTrigger = "session_waiting";

export interface AppNotification {
  readonly id: string;
  readonly trigger: NotificationTrigger;
  readonly paneId: string;
  readonly projectName: string;
  readonly summary: string | null;
  readonly timestamp: number;
  readonly read: boolean;
}

export interface NotificationStore {
  readonly notifications: readonly AppNotification[];
}

export interface CreateNotificationParams {
  readonly paneId: string;
  readonly projectName: string;
  readonly summary: string | null;
}

const MAX_NOTIFICATIONS = 50;

export const EMPTY_STORE: NotificationStore = { notifications: [] };

export function createNotification(params: CreateNotificationParams): AppNotification {
  return {
    id: crypto.randomUUID(),
    trigger: "session_waiting",
    paneId: params.paneId,
    projectName: params.projectName,
    summary: params.summary,
    timestamp: Date.now(),
    read: false,
  };
}

export function addNotification(
  store: NotificationStore,
  notification: AppNotification,
): NotificationStore {
  const next = [notification, ...store.notifications];
  return {
    notifications: next.length > MAX_NOTIFICATIONS ? next.slice(0, MAX_NOTIFICATIONS) : next,
  };
}

export function isDuplicate(
  store: NotificationStore,
  paneId: string,
  trigger: NotificationTrigger,
): boolean {
  return store.notifications.some((n) => n.paneId === paneId && n.trigger === trigger && !n.read);
}

export function markAsRead(store: NotificationStore, id: string): NotificationStore {
  const idx = store.notifications.findIndex((n) => n.id === id);
  if (idx === -1) return store;
  const updated = store.notifications.map((n) => (n.id === id ? { ...n, read: true } : n));
  return { notifications: updated };
}

export function markAllAsRead(store: NotificationStore): NotificationStore {
  if (store.notifications.every((n) => n.read)) return store;
  return { notifications: store.notifications.map((n) => (n.read ? n : { ...n, read: true })) };
}

export function dismissExpired(store: NotificationStore, maxAgeMs: number): NotificationStore {
  const cutoff = Date.now() - maxAgeMs;
  const kept = store.notifications.filter((n) => n.timestamp > cutoff);
  return kept.length === store.notifications.length ? store : { notifications: kept };
}

export function unreadCount(store: NotificationStore): number {
  let count = 0;
  for (const n of store.notifications) {
    if (!n.read) count++;
  }
  return count;
}

export function clearAll(): NotificationStore {
  return EMPTY_STORE;
}

// --- Display helpers ---

export function describeNotification(notification: AppNotification): string {
  if (notification.summary) return notification.summary;
  return "Waiting for input";
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

export function formatRelativeTime(timestamp: number): string {
  const delta = Date.now() - timestamp;
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  return `${Math.floor(delta / HOUR)}h ago`;
}
