import type { SessionGroup as SessionGroupType } from "@/lib/group-sessions";
import { SessionRow } from "./session-row";

interface SessionGroupProps {
  group: SessionGroupType;
  readStatuses: Map<string, boolean>;
  plans: Record<string, boolean> | undefined;
  onMarkAsRead: (paneId: string) => void;
}

export function SessionGroup({ group, readStatuses, plans, onMarkAsRead }: SessionGroupProps) {
  return (
    <>
      {group.orchestrator ? (
        <SessionRow
          session={group.orchestrator}
          isRead={readStatuses.get(group.orchestrator.pane_id) ?? false}
          hasPlan={plans?.[group.orchestrator.pane_id] ?? false}
          onMarkAsRead={onMarkAsRead}
          groupRole="orchestrator"
        />
      ) : (
        <tr className="orphan-group-header">
          {/* colSpan matches the 5 table columns: Project, Branch, Status, Summary, Actions */}
          <td colSpan={5}>
            <span className="project-name">{group.children[0]?.project_name}</span>
            <span className="orphan-label">orchestrator not running</span>
          </td>
        </tr>
      )}
      {group.children.map((child) => (
        <SessionRow
          key={child.pane_id}
          session={child}
          isRead={readStatuses.get(child.pane_id) ?? false}
          hasPlan={plans?.[child.pane_id] ?? false}
          onMarkAsRead={onMarkAsRead}
          groupRole="worktree-child"
        />
      ))}
    </>
  );
}
