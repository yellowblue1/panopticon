import { useReadStatusContext } from "@/contexts/read-status-context";

export function useUnreadCount(paneIds: string[]): number {
  const { snapshots } = useReadStatusContext();

  let count = 0;
  for (const id of paneIds) {
    const snapshot = snapshots.get(id);
    if (!snapshot?.isRead) count++;
  }
  return count;
}
