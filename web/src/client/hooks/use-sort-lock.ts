import type { SessionResponse } from "@shared/types";
import { useRef, useState } from "react";
import { groupSessions } from "@/lib/group-sessions";
import { applyLockedOrder, captureOrder, type LockedOrder } from "@/lib/sort-lock";

export function useSortLock(sessions: SessionResponse[]) {
  const [isSortLocked, setIsSortLocked] = useState(false);
  const lockedOrderRef = useRef<LockedOrder | null>(null);

  const freshResult = groupSessions(sessions);

  const toggleSortLock = () => {
    setIsSortLocked((prev) => {
      if (!prev) {
        // Locking: capture the current order
        lockedOrderRef.current = captureOrder(freshResult);
      } else {
        // Unlocking: clear the captured order
        lockedOrderRef.current = null;
      }
      return !prev;
    });
  };

  const displayResult =
    isSortLocked && lockedOrderRef.current
      ? applyLockedOrder(lockedOrderRef.current, sessions)
      : freshResult;

  return {
    groups: displayResult.groups,
    ungrouped: displayResult.ungrouped,
    isSortLocked,
    toggleSortLock,
  };
}
