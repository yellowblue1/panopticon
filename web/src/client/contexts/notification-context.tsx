import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  type AppNotification,
  type CreateNotificationParams,
  createNotification,
  dismissExpired,
  EMPTY_STORE,
  isDuplicate,
  type NotificationStore,
  addNotification as storeAdd,
  clearAll as storeClear,
  markAllAsRead as storeMarkAllAsRead,
  markAsRead as storeMarkAsRead,
  unreadCount as storeUnreadCount,
} from "@/lib/notification-store";

const AUTO_DISMISS_MS = 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;

interface NotificationContextValue {
  readonly notifications: readonly AppNotification[];
  readonly unreadCount: number;
  addNotification: (params: CreateNotificationParams) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAll: () => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<NotificationStore>(EMPTY_STORE);

  useEffect(() => {
    const timer = setInterval(() => {
      setStore((prev) => dismissExpired(prev, AUTO_DISMISS_MS));
    }, CLEANUP_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  const addNotificationHandler = (params: CreateNotificationParams) => {
    setStore((prev) => {
      if (isDuplicate(prev, params.paneId, "session_waiting")) return prev;
      const notification = createNotification(params);
      toast(`${params.projectName} is waiting`, {
        description: params.summary || "Agent is waiting for input",
      });
      return storeAdd(prev, notification);
    });
  };

  const markAsReadHandler = (id: string) => {
    setStore((prev) => storeMarkAsRead(prev, id));
  };

  const markAllAsReadHandler = () => {
    setStore((prev) => storeMarkAllAsRead(prev));
  };

  const clearAllHandler = () => {
    setStore(storeClear());
  };

  const value: NotificationContextValue = {
    notifications: store.notifications,
    unreadCount: storeUnreadCount(store),
    addNotification: addNotificationHandler,
    markAsRead: markAsReadHandler,
    markAllAsRead: markAllAsReadHandler,
    clearAll: clearAllHandler,
  };

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications(): NotificationContextValue {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotifications must be used within a NotificationProvider");
  }
  return context;
}
