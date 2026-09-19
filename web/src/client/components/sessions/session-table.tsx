import type { SessionResponse } from "@shared/types";
import { ArrowUpDown, CheckCheck } from "lucide-react";
import { usePlansAvailability } from "@/hooks/use-plans-availability";
import { useReadStatus } from "@/hooks/use-read-status";
import { useSortLock } from "@/hooks/use-sort-lock";
import { useUnreadCount } from "@/hooks/use-unread-count";
import { cn } from "@/lib/cn";
import { SessionGroup } from "./session-group";
import { SessionRow } from "./session-row";

interface SessionTableProps {
  sessions: SessionResponse[];
}

export function SessionTable({ sessions }: SessionTableProps) {
  const paneIds = sessions.map((s) => s.pane_id);
  const { readStatuses, lastSeenMap, markAsRead, markAllAsRead } = useReadStatus(paneIds);
  const { data: plansData } = usePlansAvailability();
  const unreadCount = useUnreadCount(paneIds);
  const { groups, ungrouped, isSortLocked, toggleSortLock } = useSortLock(sessions);

  if (sessions.length === 0) {
    return (
      <div className="empty-state">
        <p>No active sessions found.</p>
        <p className="hint">
          Sessions will appear here when Claude Code or Codex is running in tmux.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="flex justify-between items-center mb-3">
        <button
          type="button"
          className={cn("toolbar-btn", isSortLocked && "sort-lock-btn-active")}
          onClick={toggleSortLock}
        >
          <ArrowUpDown size={16} />
          {isSortLocked ? "Sort paused" : "Auto-sort"}
        </button>
        {unreadCount > 0 && (
          <button type="button" className="toolbar-btn" onClick={markAllAsRead}>
            <CheckCheck size={16} />
            Mark all as read
          </button>
        )}
      </div>
      <table className="sessions-table">
        <thead>
          <tr>
            <th className="col-project">Project</th>
            <th className="col-window">Window</th>
            <th className="col-status">Status</th>
            <th className="col-summary">Summary</th>
            <th className="col-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <SessionGroup
              key={
                group.orchestrator?.pane_id ??
                `lost-lead-${group.children[0]?.pane_id ?? "unknown"}`
              }
              group={group}
              readStatuses={readStatuses}
              lastSeenMap={lastSeenMap}
              plans={plansData?.plans}
              onMarkAsRead={markAsRead}
            />
          ))}
          {ungrouped.map((session) => (
            <SessionRow
              key={session.pane_id}
              session={session}
              isRead={readStatuses.get(session.pane_id) ?? false}
              lastSeenAt={lastSeenMap.get(session.pane_id) ?? 0}
              hasPlan={plansData?.plans[session.pane_id] ?? false}
              onMarkAsRead={markAsRead}
            />
          ))}
        </tbody>
      </table>
    </>
  );
}
