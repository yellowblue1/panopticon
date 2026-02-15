import { useMemo } from "react";
import { useReadStatusContext } from "@/contexts/read-status-context";

export function useUnreadCount(): number {
  const { snapshots } = useReadStatusContext();

  return useMemo(() => {
    let count = 0;
    for (const snapshot of snapshots.values()) {
      if (!snapshot.isRead) count++;
    }
    return count;
  }, [snapshots]);
}
