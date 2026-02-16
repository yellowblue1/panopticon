import type { SessionResponse } from "@shared/types";
import { CheckCheck } from "lucide-react";
import { usePlansAvailability } from "@/hooks/use-plans-availability";
import { useReadStatus } from "@/hooks/use-read-status";
import { useUnreadCount } from "@/hooks/use-unread-count";
import { groupSessions } from "@/lib/group-sessions";
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

  const { groups, ungrouped } = groupSessions(sessions);

  return (
    <>
      {unreadCount > 0 && (
        <div className="flex justify-end mb-3">
          <button type="button" className="mark-all-read-btn" onClick={markAllAsRead}>
            <CheckCheck size={16} />
            Mark all as read
          </button>
        </div>
      )}
      <table className="sessions-table">
        <thead>
          <tr>
            <th className="col-project">Project</th>
            <th className="col-branch">Branch</th>
            <th className="col-status">Status</th>
            <th className="col-summary">Summary</th>
            <th className="col-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <SessionGroup
              key={
                group.orchestrator?.pane_id ?? `orphan-${group.children[0]?.pane_id ?? "unknown"}`
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
