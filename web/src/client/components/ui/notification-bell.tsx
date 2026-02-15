import { Bell } from "lucide-react";
import { useRef, useState } from "react";
import { useNotifications } from "@/contexts/notification-context";
import { cn } from "@/lib/cn";
import type { AppNotification } from "@/lib/notification-store";
import { NotificationPanel } from "./notification-panel";

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { notifications, unreadCount, markAsRead, markAllAsRead, clearAll } = useNotifications();

  const handleSelect = (notification: AppNotification) => {
    markAsRead(notification.id);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          "relative inline-flex items-center justify-center",
          "bg-transparent border-none text-text-secondary rounded-md cursor-pointer transition-all",
          "hover:bg-bg-tertiary hover:text-text-primary",
          "min-w-[36px] min-h-[36px] p-1.5",
        )}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span
            className={cn(
              "absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full",
              "bg-accent-red text-white text-[11px] font-medium",
              "flex items-center justify-center px-1 leading-none",
            )}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      <NotificationPanel
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        notifications={notifications}
        unreadCount={unreadCount}
        onSelect={handleSelect}
        onMarkAllAsRead={markAllAsRead}
        onClearAll={clearAll}
      />
    </div>
  );
}
