import { compareWithHysteresis } from "@shared/sort";
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

function getGroupMaxActivity(g: SessionGroup): string {
  let max = g.orchestrator?.last_activity ?? "";
  for (const c of g.children) {
    if (c.last_activity > max) max = c.last_activity;
  }
  return max;
}

function byActivityThenPaneId(a: SessionResponse, b: SessionResponse): number {
  return compareWithHysteresis(
    a.last_activity,
    b.last_activity,
    a.pane_id.localeCompare(b.pane_id),
  );
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
  const orchestratorByCwd = new Map<string, SessionResponse[]>();
  const worktreeSessions: Array<{ session: SessionResponse; baseCwd: string }> = [];

  for (const session of sessions) {
    const base = detectWorktreeBase(session.cwd);
    if (base !== null) {
      worktreeSessions.push({ session, baseCwd: base });
    } else {
      const arr = orchestratorByCwd.get(session.cwd);
      if (arr) {
        arr.push(session);
      } else {
        orchestratorByCwd.set(session.cwd, [session]);
      }
    }
  }

  const groupsByBaseCwd = new Map<string, SessionGroup>();
  const orphansByBaseCwd = new Map<string, SessionResponse[]>();
  const usedOrchestratorCwds = new Set<string>();

  for (const { session, baseCwd } of worktreeSessions) {
    const candidates = orchestratorByCwd.get(baseCwd);
    const orchestrator = candidates?.[0];

    if (orchestrator && orchestrator.project_name === session.project_name) {
      usedOrchestratorCwds.add(baseCwd);
      const existing = groupsByBaseCwd.get(baseCwd);
      if (existing) {
        existing.children.push(session);
      } else {
        groupsByBaseCwd.set(baseCwd, { orchestrator, children: [session] });
      }
    } else {
      const orphans = orphansByBaseCwd.get(baseCwd);
      if (orphans) {
        orphans.push(session);
      } else {
        orphansByBaseCwd.set(baseCwd, [session]);
      }
    }
  }

  const groups: SessionGroup[] = [];

  for (const group of groupsByBaseCwd.values()) {
    group.children.sort(byActivityThenPaneId);
    groups.push(group);
  }

  for (const children of orphansByBaseCwd.values()) {
    children.sort(byActivityThenPaneId);
    groups.push({ orchestrator: null, children });
  }

  const maxActivityByGroup = new Map<SessionGroup, string>();
  for (const g of groups) {
    maxActivityByGroup.set(g, getGroupMaxActivity(g));
  }

  groups.sort((a, b) => {
    const tiebreaker = (a.orchestrator?.pane_id ?? a.children[0]?.pane_id ?? "").localeCompare(
      b.orchestrator?.pane_id ?? b.children[0]?.pane_id ?? "",
    );
    return compareWithHysteresis(
      maxActivityByGroup.get(a) ?? "",
      maxActivityByGroup.get(b) ?? "",
      tiebreaker,
    );
  });

  const ungrouped: SessionResponse[] = [];
  for (const [cwd, sessions] of orchestratorByCwd) {
    if (usedOrchestratorCwds.has(cwd)) {
      // First session was used as orchestrator; rest go to ungrouped
      for (let i = 1; i < sessions.length; i++) {
        ungrouped.push(sessions[i]);
      }
    } else {
      for (const session of sessions) {
        ungrouped.push(session);
      }
    }
  }

  ungrouped.sort(byActivityThenPaneId);

  return { groups, ungrouped };
}
