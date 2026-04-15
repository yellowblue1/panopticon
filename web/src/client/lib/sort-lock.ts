import type { SessionResponse } from "@shared/types";
import { type GroupedSessions, groupSessions, type SessionGroup } from "./group-sessions";

export interface LockedOrder {
  groups: Array<{
    orchestratorPaneId: string | null;
    childPaneIds: string[];
  }>;
  ungroupedPaneIds: string[];
}

/**
 * Capture the current ordering as a template of pane IDs,
 * preserving group structure and session positions.
 */
export function captureOrder(result: GroupedSessions): LockedOrder {
  return {
    groups: result.groups.map((g) => ({
      orchestratorPaneId: g.orchestrator?.pane_id ?? null,
      childPaneIds: g.children.map((c) => c.pane_id),
    })),
    ungroupedPaneIds: result.ungrouped.map((s) => s.pane_id),
  };
}

/**
 * Apply a locked ordering template to fresh session data.
 * - Removed sessions are filtered out
 * - New sessions are appended to ungrouped
 * - Session data is always fresh (current status, summary, etc.)
 */
export function applyLockedOrder(order: LockedOrder, sessions: SessionResponse[]): GroupedSessions {
  const sessionMap = new Map(sessions.map((s) => [s.pane_id, s]));
  const usedPaneIds = new Set<string>();

  const groups = order.groups
    .map((g) => {
      const orchestrator = g.orchestratorPaneId
        ? (sessionMap.get(g.orchestratorPaneId) ?? null)
        : null;
      if (orchestrator) usedPaneIds.add(orchestrator.pane_id);

      const children = g.childPaneIds
        .map((id) => sessionMap.get(id))
        .filter((s): s is SessionResponse => s !== undefined);
      for (const c of children) usedPaneIds.add(c.pane_id);

      if (!orchestrator && children.length === 0) return null;

      return { orchestrator, children } satisfies SessionGroup;
    })
    .filter((g): g is SessionGroup => g !== null);

  const ungrouped = order.ungroupedPaneIds
    .map((id) => sessionMap.get(id))
    .filter((s): s is SessionResponse => s !== undefined);
  for (const s of ungrouped) usedPaneIds.add(s.pane_id);

  // New sessions not in locked order are appended at the bottom
  const newSessions = sessions.filter((s) => !usedPaneIds.has(s.pane_id));
  // Sort new sessions by groupSessions logic so they appear in a sensible order
  const { groups: newGroups, ungrouped: newUngrouped } = groupSessions(newSessions);
  groups.push(...newGroups);
  ungrouped.push(...newUngrouped);

  return { groups, ungrouped };
}
