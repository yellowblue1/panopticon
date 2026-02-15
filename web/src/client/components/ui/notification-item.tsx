import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/cn";
import type { AppNotification } from "@/lib/notification-store";
import { describeNotification, formatRelativeTime } from "@/lib/notification-store";

interface NotificationItemProps {
  notification: AppNotification;
  onSelect: (notification: AppNotification) => void;
}

export function NotificationItem({ notification, onSelect }: NotificationItemProps) {
  return (
    <Link
      to="/sessions/$paneId"
      params={{ paneId: notification.paneId }}
      onClick={() => onSelect(notification)}
      className={cn(
        "w-full text-left px-4 py-3 flex items-start gap-3 transition-colors no-underline",
        "hover:bg-bg-secondary",
        !notification.read && "bg-bg-secondary/50",
      )}
    >
      {!notification.read && (
        <span className="mt-1.5 w-2 h-2 rounded-full bg-accent-blue shrink-0" />
      )}
      {notification.read && <span className="mt-1.5 w-2 h-2 shrink-0" />}

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-text-primary truncate">
            {notification.projectName}
          </span>
          <span className="text-xs text-text-muted shrink-0">
            {formatRelativeTime(notification.timestamp)}
          </span>
        </div>
        <p className="text-xs text-text-muted mt-0.5 truncate">
          {describeNotification(notification)}
        </p>
      </div>
    </Link>
  );
}
