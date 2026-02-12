import type { SessionResponse } from "@shared/types";
import { Link } from "@tanstack/react-router";
import { Clipboard, ClipboardCheck, SquareTerminal } from "lucide-react";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { cn } from "@/lib/cn";
import { AgentTypeIcon } from "../ui/agent-type-icon";
import { StatusBadge } from "../ui/badge";

interface SessionRowProps {
  session: SessionResponse;
  isRead: boolean;
  onMarkAsRead: (paneId: string) => void;
}

export function SessionRow({ session, isRead, onMarkAsRead }: SessionRowProps) {
  const copy = useCopyToClipboard();
  const tmuxCommand = `tmux switch-client -t ${session.pane_id}`;

  const handleCopy = async () => {
    const success = await copy(tmuxCommand, "tmux command");
    if (success && !isRead) {
      onMarkAsRead(session.pane_id);
    }
  };

  const statusClass = session.status === "busy" ? "row-busy" : "row-waiting";

  return (
    <tr className={cn(statusClass, isRead && "read")}>
      <td className="col-project">
        <div className="flex items-center gap-2">
          <AgentTypeIcon agentType={session.agent_type} />
          <span className="project-name">{session.project_name}</span>
        </div>
      </td>
      <td className="col-branch">
        {session.git_branch ? (
          <span className="git-branch">{session.git_branch}</span>
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
            className={cn("action-btn copy-action", isRead && "copied")}
            title={tmuxCommand}
            onClick={handleCopy}
          >
            {isRead ? <ClipboardCheck size={20} /> : <Clipboard size={20} />}
          </button>
        </div>
      </td>
    </tr>
  );
}
