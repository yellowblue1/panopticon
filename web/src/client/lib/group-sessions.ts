import { compareWithHysteresis } from "@shared/sort";
import type { SessionResponse } from "@shared/types";

export interface SessionGroup {
  /** Null only when sort-lock is presenting a prior group whose lead pane has since disappeared. */
  orchestrator: SessionResponse | null;
  children: SessionResponse[];
}

export interface GroupedSessions {
  groups: SessionGroup[];
  ungrouped: SessionResponse[];
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

/** Natural-numeric sort on tmux_target so 1.2 < 1.10. */
function byTmuxTarget(a: SessionResponse, b: SessionResponse): number {
  return a.tmux_target.localeCompare(b.tmux_target, undefined, { numeric: true });
}

/**
 * Panes sharing a tmux session and the lead's project_name are grouped as
 * Agent Teams siblings; mismatched project_name panes fall to ungrouped so
 * hand-split unrelated sessions don't get falsely grouped.
 */
export function groupSessions(sessions: SessionResponse[]): GroupedSessions {
  const bySession = new Map<string, SessionResponse[]>();
  for (const session of sessions) {
    const arr = bySession.get(session.tmux_session_name);
    if (arr) {
      arr.push(session);
    } else {
      bySession.set(session.tmux_session_name, [session]);
    }
  }

  const groups: SessionGroup[] = [];
  const ungrouped: SessionResponse[] = [];

  for (const entries of bySession.values()) {
    if (entries.length < 2) {
      ungrouped.push(...entries);
      continue;
    }
    entries.sort(byTmuxTarget);
    const [lead, ...rest] = entries;
    const children: SessionResponse[] = [];
    const stranded: SessionResponse[] = [];
    for (const s of rest) {
      (s.project_name === lead.project_name ? children : stranded).push(s);
    }
    if (children.length === 0) {
      ungrouped.push(...entries);
      continue;
    }
    children.sort(byActivityThenPaneId);
    groups.push({ orchestrator: lead, children });
    ungrouped.push(...stranded);
  }

  const decorated = groups.map((g) => ({ g, max: getGroupMaxActivity(g) }));
  decorated.sort((a, b) => {
    const tiebreaker = (a.g.orchestrator?.pane_id ?? a.g.children[0]?.pane_id ?? "").localeCompare(
      b.g.orchestrator?.pane_id ?? b.g.children[0]?.pane_id ?? "",
    );
    return compareWithHysteresis(a.max, b.max, tiebreaker);
  });

  ungrouped.sort(byActivityThenPaneId);

  return { groups: decorated.map((d) => d.g), ungrouped };
}
