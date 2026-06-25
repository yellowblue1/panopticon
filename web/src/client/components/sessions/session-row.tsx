import type { SessionResponse } from "@shared/types";
import { Link } from "@tanstack/react-router";
import { ArrowRightToLine, FileText, SquareTerminal } from "lucide-react";
import { useSwitchClient } from "@/hooks/use-switch-client";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { AgentTypeIcon } from "../ui/agent-type-icon";
import { StatusBadge } from "../ui/badge";

interface SessionRowProps {
  session: SessionResponse;
  isRead: boolean;
  lastSeenAt: number;
  hasPlan: boolean;
  onMarkAsRead: (paneId: string) => void;
  groupRole?: "orchestrator" | "team-child";
}

export function SessionRow({
  session,
  isRead,
  lastSeenAt,
  hasPlan,
  onMarkAsRead,
  groupRole,
}: SessionRowProps) {
  const switchClient = useSwitchClient();

  const handleSwitch = () => {
    switchClient.mutate(
      { paneId: session.pane_id },
      {
        onSuccess: () => {
          if (!isRead) {
            onMarkAsRead(session.pane_id);
          }
        },
      },
    );
  };

  const statusClass = session.status === "busy" ? "row-busy" : "row-waiting";

  return (
    <tr
      className={cn(
        statusClass,
        isRead && "read",
        groupRole === "orchestrator" && "row-orchestrator",
        groupRole === "team-child" && "row-team-child",
      )}
    >
      <td className="col-project">
        <div className="flex items-center gap-2">
          {groupRole === "team-child" && (
            <span className="team-child-indent" aria-hidden="true">
              └
            </span>
          )}
          <AgentTypeIcon agentType={session.agent_type} />
          <div className="flex flex-col">
            <span className="project-name">{session.project_name}</span>
            <span className="tmux-session-name">{session.tmux_target}</span>
            {lastSeenAt > 0 && (
              <span className="last-seen">Seen {formatRelativeTime(lastSeenAt)}</span>
            )}
          </div>
          <span className="status-badge-mobile">
            <StatusBadge variant={session.status} />
          </span>
        </div>
      </td>
      <td className="col-window">
        {session.window_name ? (
          <span className="window-name">{session.window_name}</span>
        ) : (
          <span className="no-window">-</span>
        )}
      </td>
      <td className="col-status">
        <StatusBadge variant={session.status} />
      </td>
      <td className="col-summary">
        {session.summary ? (
          <span className="summary" title={session.summary}>
            <span className="ai-indicator" title="AI-generated summary">
              ✨
            </span>
            {session.summary}
          </span>
        ) : (
          <span className="summary-placeholder">-</span>
        )}
      </td>
      <td className="col-actions">
        <div className="action-group">
          {hasPlan ? (
            <Link
              to="/sessions/$paneId"
              params={{ paneId: session.pane_id }}
              search={{ tab: "plan" }}
              className="action-btn plan-indicator"
              title="View plan"
            >
              <FileText size={20} />
            </Link>
          ) : (
            <span className="action-btn plan-placeholder">
              <FileText size={20} />
            </span>
          )}
          <Link
            to="/sessions/$paneId"
            params={{ paneId: session.pane_id }}
            search={{}}
            className="action-btn"
            title="View terminal"
          >
            <SquareTerminal size={20} />
          </Link>
          <button
            type="button"
            className="action-btn switch-action-btn"
            title={`Switch to ${session.pane_id}`}
            onClick={handleSwitch}
            disabled={switchClient.isPending}
          >
            <ArrowRightToLine size={20} />
          </button>
        </div>
      </td>
    </tr>
  );
}
