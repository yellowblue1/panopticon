import type { SessionResponse } from "@shared/types";
import { useMemo } from "react";
import { usePlansAvailability } from "@/hooks/use-plans-availability";
import { usePullRequests } from "@/hooks/use-pull-requests";
import { useReadStatus } from "@/hooks/use-read-status";
import { SessionRow } from "./session-row";

interface SessionTableProps {
  sessions: SessionResponse[];
}

export function SessionTable({ sessions }: SessionTableProps) {
  const paneIds = useMemo(() => sessions.map((s) => s.pane_id), [sessions]);
  const { readStatuses, markAsRead } = useReadStatus(paneIds);
  const { data: plansData } = usePlansAvailability();
  const { data: prsData } = usePullRequests();

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
        {sessions.map((session) => (
          <SessionRow
            key={session.pane_id}
            session={session}
            isRead={readStatuses.get(session.pane_id) ?? false}
            hasPlan={plansData?.plans[session.pane_id] ?? false}
            pullRequest={prsData?.pull_requests[session.pane_id] ?? null}
            onMarkAsRead={markAsRead}
          />
        ))}
      </tbody>
    </table>
  );
}
