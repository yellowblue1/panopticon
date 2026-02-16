import { useSessionsQuery } from "@/hooks/use-sessions";
import { useUnreadCount } from "@/hooks/use-unread-count";

export function UnreadBadge() {
  const { data } = useSessionsQuery();
  const paneIds = data?.sessions.map((s) => s.pane_id) ?? [];
  const count = useUnreadCount(paneIds);
  if (count === 0) return null;

  return <span className="unread-badge">{count > 99 ? "99+" : count}</span>;
}
