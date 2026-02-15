import { useReadStatus } from "@/hooks/use-read-status";
import { useSessionsQuery } from "@/hooks/use-sessions";

export function useUnreadCount(): number {
  const { data } = useSessionsQuery();
  const paneIds = data?.sessions.map((s) => s.pane_id) ?? [];
  const { readStatuses } = useReadStatus(paneIds);

  let count = 0;
  for (const isRead of readStatuses.values()) {
    if (!isRead) count++;
  }
  return count;
}
