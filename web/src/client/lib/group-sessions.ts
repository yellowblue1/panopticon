import type { SessionResponse } from "@shared/types";

export interface SessionGroup {
  /** Orchestrator session, or null when only worktree children exist (orphan group) */
  orchestrator: SessionResponse | null;
  /** Worktree child sessions sorted by last_activity descending */
  children: SessionResponse[];
}

export interface GroupedSessions {
  /** Groups containing orchestrator + worktree children */
  groups: SessionGroup[];
  /** Sessions not part of any worktree relationship */
  ungrouped: SessionResponse[];
}

/**
 * Detect worktree base path from a cwd.
 * If cwd matches `{base}-worktrees/{anything}`, returns `{base}`.
 * Otherwise returns null.
 */
export function detectWorktreeBase(cwd: string): string | null {
  const idx = cwd.indexOf("-worktrees/");
  if (idx === -1) return null;
  const afterWorktrees = cwd.slice(idx + "-worktrees/".length).replace(/\/$/, "");
  if (afterWorktrees.length === 0) return null;
  return cwd.slice(0, idx);
}

/**
 * Group sessions by orchestrator/worktree relationship.
 *
 * 1. Classify each session as potential orchestrator or worktree child
 * 2. Match worktree children to orchestrators by baseCwd + project_name
 * 3. Orphan worktrees (no running orchestrator) form groups with null orchestrator
 * 4. Remaining non-worktree sessions go to ungrouped
 */
export function groupSessions(sessions: SessionResponse[]): GroupedSessions {
  const orchestratorByCwd = new Map<string, SessionResponse>();
  const worktreeSessions: Array<{ session: SessionResponse; baseCwd: string }> = [];

  for (const session of sessions) {
    const base = detectWorktreeBase(session.cwd);
    if (base !== null) {
      worktreeSessions.push({ session, baseCwd: base });
    } else {
      orchestratorByCwd.set(session.cwd, session);
    }
  }

  const groupsByBaseCwd = new Map<string, SessionGroup>();
  const orphansByBaseCwd = new Map<string, SessionResponse[]>();
  const usedOrchestratorCwds = new Set<string>();

  for (const { session, baseCwd } of worktreeSessions) {
    const orchestrator = orchestratorByCwd.get(baseCwd);

    if (orchestrator && orchestrator.project_name === session.project_name) {
      usedOrchestratorCwds.add(baseCwd);
      const existing = groupsByBaseCwd.get(baseCwd);
      if (existing) {
        existing.children.push(session);
      } else {
        groupsByBaseCwd.set(baseCwd, { orchestrator, children: [session] });
      }
    } else {
      const existing = orphansByBaseCwd.get(baseCwd);
      if (existing) {
        existing.push(session);
      } else {
        orphansByBaseCwd.set(baseCwd, [session]);
      }
    }
  }

  const groups: SessionGroup[] = [];

  for (const group of groupsByBaseCwd.values()) {
    group.children.sort((a, b) => b.last_activity.localeCompare(a.last_activity));
    groups.push(group);
  }

  for (const children of orphansByBaseCwd.values()) {
    children.sort((a, b) => b.last_activity.localeCompare(a.last_activity));
    groups.push({ orchestrator: null, children });
  }

  groups.sort((a, b) => {
    const aTime = a.orchestrator?.last_activity ?? a.children[0]?.last_activity ?? "";
    const bTime = b.orchestrator?.last_activity ?? b.children[0]?.last_activity ?? "";
    return bTime.localeCompare(aTime);
  });

  const ungrouped: SessionResponse[] = [];
  for (const [cwd, session] of orchestratorByCwd) {
    if (!usedOrchestratorCwds.has(cwd)) {
      ungrouped.push(session);
    }
  }

  return { groups, ungrouped };
}
