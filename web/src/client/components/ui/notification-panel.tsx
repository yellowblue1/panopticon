import { X } from "lucide-react";
import { useEffect } from "react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/cn";
import type { AppNotification } from "@/lib/notification-store";
import { NotificationItem } from "./notification-item";

interface NotificationPanelProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: readonly AppNotification[];
  unreadCount: number;
  onSelect: (notification: AppNotification) => void;
  onMarkAllAsRead: () => void;
  onClearAll: () => void;
}

export function NotificationPanel({
  isOpen,
  onClose,
  notifications,
  unreadCount,
  onSelect,
  onMarkAllAsRead,
  onClearAll,
}: NotificationPanelProps) {
  const isMobile = useMediaQuery("(max-width: 639px)");

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40",
          isMobile && "bg-black/50 backdrop-blur-sm",
          "transition-opacity duration-200 ease-out",
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        onClick={onClose}
        aria-hidden={!isOpen}
      />

      {/* Panel */}
      <div
        className={cn(
          "z-50 bg-bg-primary border border-border-default shadow-2xl",
          "flex flex-col overflow-hidden",
          "transition-all duration-200 ease-out",
          isMobile && "fixed inset-x-0 bottom-0 top-16 rounded-t-xl",
          isMobile &&
            (isOpen
              ? "translate-y-0 opacity-100"
              : "translate-y-full opacity-0 pointer-events-none"),
          !isMobile && "absolute right-0 top-full mt-2 w-[380px] rounded-xl",
          !isMobile &&
            (isOpen ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"),
        )}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
      >
        {/* Mobile drag handle */}
        {isMobile && (
          <div className="flex justify-center pt-2 pb-1">
            <div className="w-10 h-1 rounded-full bg-border-default" />
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <span className="text-sm font-medium text-text-primary">Notifications</span>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={onMarkAllAsRead}
                className="text-xs text-accent-blue hover:text-accent-blue/80 transition-colors cursor-pointer bg-transparent border-none"
              >
                Mark all as read
              </button>
            )}
            {notifications.length > 0 && (
              <button
                type="button"
                onClick={onClearAll}
                className="text-xs text-text-muted hover:text-text-primary transition-colors cursor-pointer bg-transparent border-none"
              >
                Clear all
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className={cn(
                "shrink-0 flex items-center justify-center",
                "w-7 h-7 rounded-md",
                "text-text-muted hover:text-text-primary hover:bg-bg-tertiary",
                "transition-colors cursor-pointer bg-transparent border-none",
              )}
              aria-label="Close notifications"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Notification list */}
        <div
          className={cn(
            "overflow-y-auto overscroll-contain",
            isMobile ? "flex-1 pb-[max(12px,env(safe-area-inset-bottom))]" : "max-h-[400px]",
          )}
        >
          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-text-muted text-sm">No notifications</div>
          ) : (
            notifications.map((n) => (
              <NotificationItem key={n.id} notification={n} onSelect={onSelect} />
            ))
          )}
        </div>
      </div>
    </>
  );
}
