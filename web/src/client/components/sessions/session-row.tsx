import type { PullRequestInfo, SessionResponse } from "@shared/types";
import { Link } from "@tanstack/react-router";
import { ArrowRightToLine, FileText, SquareTerminal } from "lucide-react";
import { useSwitchClient } from "@/hooks/use-switch-client";
import { cn } from "@/lib/cn";
import { AgentTypeIcon } from "../ui/agent-type-icon";
import { StatusBadge } from "../ui/badge";
import { PrBadge } from "../ui/pr-badge";

interface SessionRowProps {
  session: SessionResponse;
  isRead: boolean;
  hasPlan: boolean;
  pullRequest: PullRequestInfo | null;
  onMarkAsRead: (paneId: string) => void;
}

export function SessionRow({
  session,
  isRead,
  hasPlan,
  pullRequest,
  onMarkAsRead,
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
    <tr className={cn(statusClass, isRead && "read")}>
      <td className="col-project">
        <div className="flex items-center gap-2">
          <AgentTypeIcon agentType={session.agent_type} />
          <span className="project-name">{session.project_name}</span>
          <span className="status-badge-mobile">
            <StatusBadge variant={session.status} />
          </span>
          {pullRequest && <PrBadge pr={pullRequest} className="pr-badge-mobile" />}
        </div>
      </td>
      <td className="col-branch">
        {session.git_branch ? (
          <span className="branch-group">
            <span className="git-branch">{session.git_branch}</span>
            {pullRequest && <PrBadge pr={pullRequest} className="pr-badge-desktop" />}
          </span>
        ) : (
          <span className="no-branch">-</span>
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
