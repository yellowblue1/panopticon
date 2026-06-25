import { describe, expect, it } from "bun:test";
import type { SessionResponse } from "@shared/types";
import { groupSessions } from "./group-sessions";

function makeSession(overrides: Partial<SessionResponse>): SessionResponse {
  return {
    pane_id: "%0",
    project_name: "myproject",
    window_name: "main",
    github_repo_url: null,
    status: "busy",
    summary: null,
    cwd: "/home/user/myproject",
    tmux_target: "main:0.0",
    tmux_session_name: "main",
    last_activity: "2026-02-16T00:00:00.000Z",
    agent_type: "claude",
    ...overrides,
  };
}

describe("groupSessions", () => {
  it("returns empty result for empty input", () => {
    const result = groupSessions([]);
    expect(result.groups).toHaveLength(0);
    expect(result.ungrouped).toHaveLength(0);
  });

  it("puts a single-pane tmux session in ungrouped", () => {
    const sessions = [
      makeSession({ pane_id: "%0", tmux_session_name: "a", tmux_target: "a:0.0" }),
      makeSession({
        pane_id: "%1",
        tmux_session_name: "b",
        tmux_target: "b:0.0",
        project_name: "project-b",
      }),
    ];

    const result = groupSessions(sessions);
    expect(result.groups).toHaveLength(0);
    expect(result.ungrouped).toHaveLength(2);
  });

  it("groups two same-session panes that share a project_name", () => {
    const lead = makeSession({
      pane_id: "%0",
      tmux_session_name: "main",
      tmux_target: "main:0.0",
      last_activity: "2026-02-16T00:02:00.000Z",
    });
    const child = makeSession({
      pane_id: "%1",
      tmux_session_name: "main",
      tmux_target: "main:1.0",
      last_activity: "2026-02-16T00:01:00.000Z",
    });

    const result = groupSessions([child, lead]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].orchestrator?.pane_id).toBe("%0");
    expect(result.groups[0].children.map((c) => c.pane_id)).toEqual(["%1"]);
    expect(result.ungrouped).toHaveLength(0);
  });

  it("groups same-session panes even when cwd differs (orchestrator-mode cd case)", () => {
    const lead = makeSession({
      pane_id: "%0",
      tmux_session_name: "main",
      tmux_target: "main:0.0",
      cwd: "/home/user/myproject",
    });
    const child = makeSession({
      pane_id: "%1",
      tmux_session_name: "main",
      tmux_target: "main:1.0",
      cwd: "/home/user/myproject/packages/web",
    });

    const result = groupSessions([lead, child]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].children.map((c) => c.pane_id)).toEqual(["%1"]);
    expect(result.ungrouped).toHaveLength(0);
  });

  it("picks the lowest tmux_target as lead within a tmux session", () => {
    const sessions = [
      makeSession({ pane_id: "%1", tmux_session_name: "s", tmux_target: "s:1.2" }),
      makeSession({ pane_id: "%0", tmux_session_name: "s", tmux_target: "s:1.1" }),
      makeSession({ pane_id: "%2", tmux_session_name: "s", tmux_target: "s:2.1" }),
    ];

    const result = groupSessions(sessions);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].orchestrator?.tmux_target).toBe("s:1.1");
    expect(result.groups[0].children.map((s) => s.tmux_target).sort()).toEqual(["s:1.2", "s:2.1"]);
  });

  it("orders tmux_target naturally so 1.10 sorts after 1.2", () => {
    const sessions = [
      makeSession({ pane_id: "%0", tmux_session_name: "p", tmux_target: "p:1.10" }),
      makeSession({ pane_id: "%1", tmux_session_name: "p", tmux_target: "p:1.2" }),
      makeSession({ pane_id: "%2", tmux_session_name: "p", tmux_target: "p:2.1" }),
    ];

    const result = groupSessions(sessions);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].orchestrator?.tmux_target).toBe("p:1.2");
    expect(
      result.groups[0].children.map((s) => s.tmux_target).sort((a, b) => a.localeCompare(b)),
    ).toEqual(["p:1.10", "p:2.1"]);
  });

  it("leaves all panes ungrouped when the lead has no matching project_name siblings", () => {
    const lead = makeSession({
      pane_id: "%0",
      tmux_session_name: "shared",
      tmux_target: "shared:0.0",
      project_name: "proj-a",
    });
    const stranger = makeSession({
      pane_id: "%1",
      tmux_session_name: "shared",
      tmux_target: "shared:0.1",
      project_name: "proj-b",
    });

    const result = groupSessions([lead, stranger]);
    expect(result.groups).toEqual([]);
    expect(result.ungrouped.map((s) => s.pane_id).sort()).toEqual(["%0", "%1"]);
  });

  it("groups only siblings matching the lead's project_name and ungrouped the rest", () => {
    const lead = makeSession({
      pane_id: "%0",
      tmux_session_name: "s",
      tmux_target: "s:0.0",
      project_name: "team",
    });
    const worker = makeSession({
      pane_id: "%1",
      tmux_session_name: "s",
      tmux_target: "s:0.1",
      project_name: "team",
    });
    const stranger = makeSession({
      pane_id: "%2",
      tmux_session_name: "s",
      tmux_target: "s:0.2",
      project_name: "other",
    });

    const result = groupSessions([lead, worker, stranger]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].orchestrator?.pane_id).toBe("%0");
    expect(result.groups[0].children.map((c) => c.pane_id)).toEqual(["%1"]);
    expect(result.ungrouped.map((s) => s.pane_id)).toEqual(["%2"]);
  });

  it("forms separate groups for different tmux sessions sharing a project_name", () => {
    const a1 = makeSession({
      pane_id: "%0",
      tmux_session_name: "sess-a",
      tmux_target: "sess-a:0.0",
    });
    const a2 = makeSession({
      pane_id: "%1",
      tmux_session_name: "sess-a",
      tmux_target: "sess-a:0.1",
    });
    const b1 = makeSession({
      pane_id: "%2",
      tmux_session_name: "sess-b",
      tmux_target: "sess-b:0.0",
    });
    const b2 = makeSession({
      pane_id: "%3",
      tmux_session_name: "sess-b",
      tmux_target: "sess-b:0.1",
    });

    const result = groupSessions([a1, a2, b1, b2]);
    expect(result.ungrouped).toEqual([]);
    expect(result.groups).toHaveLength(2);
    const groupA = result.groups.find((g) => g.orchestrator?.pane_id === "%0");
    const groupB = result.groups.find((g) => g.orchestrator?.pane_id === "%2");
    expect(groupA?.children.map((c) => c.pane_id)).toEqual(["%1"]);
    expect(groupB?.children.map((c) => c.pane_id)).toEqual(["%3"]);
  });

  it("sorts children within a group by last_activity descending", () => {
    const sessions = [
      makeSession({
        pane_id: "%0",
        tmux_session_name: "s",
        tmux_target: "s:0.0",
        last_activity: "2026-02-16T00:10:00.000Z",
      }),
      makeSession({
        pane_id: "%1",
        tmux_session_name: "s",
        tmux_target: "s:0.1",
        last_activity: "2026-02-16T00:01:00.000Z",
      }),
      makeSession({
        pane_id: "%2",
        tmux_session_name: "s",
        tmux_target: "s:0.2",
        last_activity: "2026-02-16T00:05:00.000Z",
      }),
    ];

    const result = groupSessions(sessions);
    const group = result.groups[0];
    expect(group.children[0].pane_id).toBe("%2");
    expect(group.children[1].pane_id).toBe("%1");
  });

  it("keeps children in stable pane_id order when last_activity is within hysteresis threshold", () => {
    const sessions = [
      makeSession({
        pane_id: "%0",
        tmux_session_name: "s",
        tmux_target: "s:0.0",
        last_activity: "2026-02-16T00:10:00.000Z",
      }),
      makeSession({
        pane_id: "%1",
        tmux_session_name: "s",
        tmux_target: "s:0.1",
        last_activity: "2026-02-16T00:05:02.000Z",
      }),
      makeSession({
        pane_id: "%2",
        tmux_session_name: "s",
        tmux_target: "s:0.2",
        last_activity: "2026-02-16T00:05:04.000Z",
      }),
    ];

    const result = groupSessions(sessions);
    const group = result.groups[0];
    expect(group.children[0].pane_id).toBe("%1");
    expect(group.children[1].pane_id).toBe("%2");
  });

  it("sorts groups by max activity across all members", () => {
    const sessions = [
      makeSession({
        pane_id: "%0",
        tmux_session_name: "sess-old",
        tmux_target: "sess-old:0.0",
        project_name: "old-project",
        last_activity: "2026-02-16T00:01:00.000Z",
      }),
      makeSession({
        pane_id: "%1",
        tmux_session_name: "sess-old",
        tmux_target: "sess-old:0.1",
        project_name: "old-project",
        last_activity: "2026-02-16T00:06:00.000Z",
      }),
      makeSession({
        pane_id: "%2",
        tmux_session_name: "sess-new",
        tmux_target: "sess-new:0.0",
        project_name: "new-project",
        last_activity: "2026-02-16T00:05:00.000Z",
      }),
      makeSession({
        pane_id: "%3",
        tmux_session_name: "sess-new",
        tmux_target: "sess-new:0.1",
        project_name: "new-project",
        last_activity: "2026-02-16T00:04:00.000Z",
      }),
    ];

    const result = groupSessions(sessions);
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].orchestrator?.project_name).toBe("old-project");
    expect(result.groups[1].orchestrator?.project_name).toBe("new-project");
  });

  it("keeps groups in stable order when max activities are within hysteresis threshold", () => {
    const sessions = [
      makeSession({
        pane_id: "%0",
        tmux_session_name: "sess-a",
        tmux_target: "sess-a:0.0",
        project_name: "project-a",
        last_activity: "2026-02-16T00:05:01.000Z",
      }),
      makeSession({
        pane_id: "%1",
        tmux_session_name: "sess-a",
        tmux_target: "sess-a:0.1",
        project_name: "project-a",
        last_activity: "2026-02-16T00:05:03.000Z",
      }),
      makeSession({
        pane_id: "%2",
        tmux_session_name: "sess-b",
        tmux_target: "sess-b:0.0",
        project_name: "project-b",
        last_activity: "2026-02-16T00:05:02.000Z",
      }),
      makeSession({
        pane_id: "%3",
        tmux_session_name: "sess-b",
        tmux_target: "sess-b:0.1",
        project_name: "project-b",
        last_activity: "2026-02-16T00:05:04.000Z",
      }),
    ];

    const result = groupSessions(sessions);
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].orchestrator?.project_name).toBe("project-a");
    expect(result.groups[1].orchestrator?.project_name).toBe("project-b");
  });

  it("sorts ungrouped sessions by activity descending with hysteresis", () => {
    const sessions = [
      makeSession({
        pane_id: "%2",
        tmux_session_name: "c",
        tmux_target: "c:0.0",
        project_name: "project-c",
        last_activity: "2026-02-16T00:01:00.000Z",
      }),
      makeSession({
        pane_id: "%0",
        tmux_session_name: "a",
        tmux_target: "a:0.0",
        project_name: "project-a",
        last_activity: "2026-02-16T00:10:00.000Z",
      }),
      makeSession({
        pane_id: "%1",
        tmux_session_name: "b",
        tmux_target: "b:0.0",
        project_name: "project-b",
        last_activity: "2026-02-16T00:05:00.000Z",
      }),
    ];

    const result = groupSessions(sessions);
    expect(result.ungrouped.map((s) => s.pane_id)).toEqual(["%0", "%1", "%2"]);
  });

  it("keeps ungrouped in stable pane_id order when activity is within hysteresis threshold", () => {
    const sessions = [
      makeSession({
        pane_id: "%1",
        tmux_session_name: "b",
        tmux_target: "b:0.0",
        project_name: "project-b",
        last_activity: "2026-02-16T00:05:03.000Z",
      }),
      makeSession({
        pane_id: "%0",
        tmux_session_name: "a",
        tmux_target: "a:0.0",
        project_name: "project-a",
        last_activity: "2026-02-16T00:05:01.000Z",
      }),
    ];

    const result = groupSessions(sessions);
    expect(result.ungrouped.map((s) => s.pane_id)).toEqual(["%0", "%1"]);
  });
});
