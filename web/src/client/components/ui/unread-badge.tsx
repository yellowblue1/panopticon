import { useUnreadCount } from "@/hooks/use-unread-count";

export function UnreadBadge() {
  const count = useUnreadCount();
  if (count === 0) return null;

  return <span className="unread-badge">{count > 99 ? "99+" : count}</span>;
}
