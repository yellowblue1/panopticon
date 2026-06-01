import { describe, expect, it } from "bun:test";
import type { SessionResponse } from "@shared/types";
import { detectWorktreeBase, groupSessions } from "./group-sessions";

function makeSession(overrides: Partial<SessionResponse> & { cwd: string }): SessionResponse {
  return {
    pane_id: "%0",
    project_name: "myproject",
    git_branch: "main",
    github_repo_url: null,
    status: "busy",
    summary: null,
    tmux_target: "main:0.0",
    tmux_session_name: "main",
    last_activity: "2026-02-16T00:00:00.000Z",
    agent_type: "claude",
    ...overrides,
  };
}

describe("detectWorktreeBase", () => {
  it("extracts base path from worktree cwd with trailing slash", () => {
    expect(detectWorktreeBase("/home/user/myproject-worktrees/feat-auth/")).toBe(
      "/home/user/myproject",
    );
  });

  it("extracts base path from worktree cwd without trailing slash", () => {
    expect(detectWorktreeBase("/home/user/myproject-worktrees/feat-auth")).toBe(
      "/home/user/myproject",
    );
  });

  it("handles deeply nested base paths", () => {
    expect(detectWorktreeBase("/home/user/src/repos/myproject-worktrees/fix-bug/")).toBe(
      "/home/user/src/repos/myproject",
    );
  });

  it("handles branch names with slashes", () => {
    expect(detectWorktreeBase("/home/user/myproject-worktrees/feat/nested-branch/")).toBe(
      "/home/user/myproject",
    );
  });

  it("returns null for non-worktree path", () => {
    expect(detectWorktreeBase("/home/user/myproject")).toBeNull();
  });

  it("returns null for non-worktree path with trailing slash", () => {
    expect(detectWorktreeBase("/home/user/myproject/")).toBeNull();
  });

  it("returns null for path containing 'worktrees' not as suffix pattern", () => {
    expect(detectWorktreeBase("/home/user/worktrees/something")).toBeNull();
  });

  it("returns null for path ending with -worktrees without branch", () => {
    expect(detectWorktreeBase("/home/user/myproject-worktrees")).toBeNull();
  });
});

describe("groupSessions", () => {
  it("returns empty result for empty input", () => {
    const result = groupSessions([]);
    expect(result.groups).toHaveLength(0);
    expect(result.ungrouped).toHaveLength(0);
  });

  it("puts all sessions in ungrouped when no worktree patterns exist", () => {
    const sessions = [
      makeSession({ pane_id: "%0", cwd: "/home/user/project-a" }),
      makeSession({ pane_id: "%1", cwd: "/home/user/project-b", project_name: "project-b" }),
    ];

    const result = groupSessions(sessions);
    expect(result.groups).toHaveLength(0);
    expect(result.ungrouped).toHaveLength(2);
  });

  it("keeps all sessions with the same cwd as ungrouped", () => {
    const sessions = [
      makeSession({
        pane_id: "%0",
        cwd: "/home/user/myproject",
        last_activity: "2026-02-16T00:02:00.000Z",
      }),
      makeSession({
        pane_id: "%1",
        cwd: "/home/user/myproject",
        last_activity: "2026-02-16T00:01:00.000Z",
      }),
    ];

    const result = groupSessions(sessions);
    expect(result.groups).toHaveLength(0);
    expect(result.ungrouped).toHaveLength(2);
    expect(result.ungrouped.map((s) => s.pane_id)).toEqual(expect.arrayContaining(["%0", "%1"]));
  });

  it("picks the lowest tmux_target as orchestrator when multiple sessions share a cwd", () => {
    // Reproduces the agent-factory case: 1.1 is the real orchestrator, 1.2 is
    // an unrelated session in the same base cwd, and 2.1 is the worker for
    // 1.1. Insertion order puts 1.2 first, but the heuristic must still pick
    // 1.1 so the worker is grouped under the right parent and 1.2 falls to
    // ungrouped.
    const sessions = [
      makeSession({
        pane_id: "%1",
        tmux_target: "agent-factory:1.2",
        cwd: "/home/user/agent-factory",
        last_activity: "2026-05-31T00:03:00.000Z",
      }),
      makeSession({
        pane_id: "%0",
        tmux_target: "agent-factory:1.1",
        cwd: "/home/user/agent-factory",
        last_activity: "2026-05-31T00:02:00.000Z",
      }),
      makeSession({
        pane_id: "%2",
        tmux_target: "agent-factory:2.1",
        cwd: "/home/user/agent-factory-worktrees/feat-x",
        last_activity: "2026-05-31T00:01:00.000Z",
      }),
    ];

    const result = groupSessions(sessions);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].orchestrator?.tmux_target).toBe("agent-factory:1.1");
    expect(result.groups[0].children).toHaveLength(1);
    expect(result.groups[0].children[0].tmux_target).toBe("agent-factory:2.1");
    expect(result.ungrouped).toHaveLength(1);
    expect(result.ungrouped[0].tmux_target).toBe("agent-factory:1.2");
  });

  it("orders tmux_target naturally so 1.10 sorts after 1.2", () => {
    const sessions = [
      makeSession({
        pane_id: "%0",
        tmux_target: "p:1.10",
        cwd: "/home/user/p",
        last_activity: "2026-05-31T00:03:00.000Z",
      }),
      makeSession({
        pane_id: "%1",
        tmux_target: "p:1.2",
        cwd: "/home/user/p",
        last_activity: "2026-05-31T00:02:00.000Z",
      }),
      makeSession({
        pane_id: "%2",
        tmux_target: "p:2.1",
        cwd: "/home/user/p-worktrees/feat",
        last_activity: "2026-05-31T00:01:00.000Z",
      }),
    ];

    const result = groupSessions(sessions);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].orchestrator?.tmux_target).toBe("p:1.2");
    expect(result.ungrouped).toHaveLength(1);
    expect(result.ungrouped[0].tmux_target).toBe("p:1.10");
  });

  it("uses one session as orchestrator and keeps duplicates ungrouped", () => {
    const sessions = [
      makeSession({
        pane_id: "%0",
        cwd: "/home/user/myproject",
        last_activity: "2026-02-16T00:03:00.000Z",
      }),
      makeSession({
        pane_id: "%1",
        cwd: "/home/user/myproject",
        last_activity: "2026-02-16T00:02:00.000Z",
      }),
      makeSession({
        pane_id: "%2",
        cwd: "/home/user/myproject-worktrees/feat-auth",
        last_activity: "2026-02-16T00:01:00.000Z",
      }),
    ];

    const result = groupSessions(sessions);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].orchestrator?.pane_id).toBe("%0");
    expect(result.groups[0].children).toHaveLength(1);
    expect(result.ungrouped).toHaveLength(1);
    expect(result.ungrouped[0].pane_id).toBe("%1");
  });

  it("groups orchestrator with its worktree children", () => {
    const orchestrator = makeSession({
      pane_id: "%0",
      cwd: "/home/user/myproject",
      last_activity: "2026-02-16T00:03:00.000Z",
    });
    const child1 = makeSession({
      pane_id: "%1",
      cwd: "/home/user/myproject-worktrees/feat-auth",
      git_branch: "feat-auth",
      last_activity: "2026-02-16T00:02:00.000Z",
    });
    const child2 = makeSession({
      pane_id: "%2",
      cwd: "/home/user/myproject-worktrees/fix-bug",
      git_branch: "fix-bug",
      last_activity: "2026-02-16T00:01:00.000Z",
    });

    const result = groupSessions([orchestrator, child1, child2]);

    expect(result.groups).toHaveLength(1);
    expect(result.ungrouped).toHaveLength(0);

    const group = result.groups[0];
    expect(group.orchestrator?.pane_id).toBe("%0");
    expect(group.children).toHaveLength(2);
    expect(group.children[0].pane_id).toBe("%1");
    expect(group.children[1].pane_id).toBe("%2");
  });

  it("creates orphan group when orchestrator is not running", () => {
    const child1 = makeSession({
      pane_id: "%1",
      cwd: "/home/user/myproject-worktrees/feat-auth",
      last_activity: "2026-02-16T00:02:00.000Z",
    });
    const child2 = makeSession({
      pane_id: "%2",
      cwd: "/home/user/myproject-worktrees/fix-bug",
      last_activity: "2026-02-16T00:01:00.000Z",
    });

    const result = groupSessions([child1, child2]);

    expect(result.groups).toHaveLength(1);
    expect(result.ungrouped).toHaveLength(0);

    const group = result.groups[0];
    expect(group.orchestrator).toBeNull();
    expect(group.children).toHaveLength(2);
  });

  it("does not group when project_name differs despite matching cwd pattern", () => {
    const orchestrator = makeSession({
      pane_id: "%0",
      cwd: "/home/user/myproject",
      project_name: "myproject",
    });
    const child = makeSession({
      pane_id: "%1",
      cwd: "/home/user/myproject-worktrees/feat-auth",
      project_name: "different-project",
    });

    const result = groupSessions([orchestrator, child]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].orchestrator).toBeNull();
    expect(result.groups[0].children).toHaveLength(1);
    expect(result.groups[0].children[0].pane_id).toBe("%1");

    expect(result.ungrouped).toHaveLength(1);
    expect(result.ungrouped[0].pane_id).toBe("%0");
  });

  it("handles multiple groups and ungrouped sessions together", () => {
    const sessions = [
      makeSession({
        pane_id: "%0",
        cwd: "/home/user/project-a",
        project_name: "project-a",
        last_activity: "2026-02-16T00:05:00.000Z",
      }),
      makeSession({
        pane_id: "%1",
        cwd: "/home/user/project-a-worktrees/feat-x",
        project_name: "project-a",
        last_activity: "2026-02-16T00:04:00.000Z",
      }),
      makeSession({
        pane_id: "%2",
        cwd: "/home/user/project-b",
        project_name: "project-b",
        last_activity: "2026-02-16T00:03:00.000Z",
      }),
      makeSession({
        pane_id: "%3",
        cwd: "/home/user/project-b-worktrees/fix-y",
        project_name: "project-b",
        last_activity: "2026-02-16T00:02:00.000Z",
      }),
      makeSession({
        pane_id: "%4",
        cwd: "/home/user/standalone",
        project_name: "standalone",
        last_activity: "2026-02-16T00:01:00.000Z",
      }),
    ];

    const result = groupSessions(sessions);

    expect(result.groups).toHaveLength(2);
    expect(result.ungrouped).toHaveLength(1);
    expect(result.ungrouped[0].pane_id).toBe("%4");
  });

  it("sorts children within a group by last_activity descending", () => {
    const sessions = [
      makeSession({
        pane_id: "%0",
        cwd: "/home/user/myproject",
        last_activity: "2026-02-16T00:10:00.000Z",
      }),
      makeSession({
        pane_id: "%1",
        cwd: "/home/user/myproject-worktrees/old-branch",
        last_activity: "2026-02-16T00:01:00.000Z",
      }),
      makeSession({
        pane_id: "%2",
        cwd: "/home/user/myproject-worktrees/new-branch",
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
        cwd: "/home/user/myproject",
        last_activity: "2026-02-16T00:10:00.000Z",
      }),
      makeSession({
        pane_id: "%1",
        cwd: "/home/user/myproject-worktrees/branch-a",
        last_activity: "2026-02-16T00:05:02.000Z",
      }),
      makeSession({
        pane_id: "%2",
        cwd: "/home/user/myproject-worktrees/branch-b",
        last_activity: "2026-02-16T00:05:04.000Z",
      }),
    ];

    const result = groupSessions(sessions);
    const group = result.groups[0];
    // %2 has slightly newer activity (2s difference < 5s threshold),
    // so order falls back to pane_id ascending: %1 before %2
    expect(group.children[0].pane_id).toBe("%1");
    expect(group.children[1].pane_id).toBe("%2");
  });

  it("keeps groups in stable order when max activities are within hysteresis threshold", () => {
    const sessions = [
      makeSession({
        pane_id: "%0",
        cwd: "/home/user/project-a",
        project_name: "project-a",
        last_activity: "2026-02-16T00:05:01.000Z",
      }),
      makeSession({
        pane_id: "%1",
        cwd: "/home/user/project-a-worktrees/feat",
        project_name: "project-a",
        last_activity: "2026-02-16T00:05:03.000Z",
      }),
      makeSession({
        pane_id: "%2",
        cwd: "/home/user/project-b",
        project_name: "project-b",
        last_activity: "2026-02-16T00:05:02.000Z",
      }),
      makeSession({
        pane_id: "%3",
        cwd: "/home/user/project-b-worktrees/feat",
        project_name: "project-b",
        last_activity: "2026-02-16T00:05:04.000Z",
      }),
    ];

    const result = groupSessions(sessions);
    expect(result.groups).toHaveLength(2);
    // Max activities: project-a=00:05:03, project-b=00:05:04 (1s diff < 5s threshold)
    // Falls back to orchestrator pane_id: %0 < %2, so project-a first
    expect(result.groups[0].orchestrator?.project_name).toBe("project-a");
    expect(result.groups[1].orchestrator?.project_name).toBe("project-b");
  });

  it("sorts ungrouped sessions by activity descending with hysteresis", () => {
    const sessions = [
      makeSession({
        pane_id: "%2",
        cwd: "/home/user/project-c",
        project_name: "project-c",
        last_activity: "2026-02-16T00:01:00.000Z",
      }),
      makeSession({
        pane_id: "%0",
        cwd: "/home/user/project-a",
        project_name: "project-a",
        last_activity: "2026-02-16T00:10:00.000Z",
      }),
      makeSession({
        pane_id: "%1",
        cwd: "/home/user/project-b",
        project_name: "project-b",
        last_activity: "2026-02-16T00:05:00.000Z",
      }),
    ];

    const result = groupSessions(sessions);
    expect(result.ungrouped).toHaveLength(3);
    // Sorted by last_activity descending: %0 (00:10) > %1 (00:05) > %2 (00:01)
    expect(result.ungrouped.map((s) => s.pane_id)).toEqual(["%0", "%1", "%2"]);
  });

  it("keeps ungrouped in stable pane_id order when activity is within hysteresis threshold", () => {
    const sessions = [
      makeSession({
        pane_id: "%1",
        cwd: "/home/user/project-b",
        project_name: "project-b",
        last_activity: "2026-02-16T00:05:03.000Z",
      }),
      makeSession({
        pane_id: "%0",
        cwd: "/home/user/project-a",
        project_name: "project-a",
        last_activity: "2026-02-16T00:05:01.000Z",
      }),
    ];

    const result = groupSessions(sessions);
    expect(result.ungrouped).toHaveLength(2);
    // 2s difference < 5s threshold, falls back to pane_id ascending: %0 before %1
    expect(result.ungrouped.map((s) => s.pane_id)).toEqual(["%0", "%1"]);
  });

  it("sorts groups by max activity across all members, not just orchestrator", () => {
    const sessions = [
      makeSession({
        pane_id: "%0",
        cwd: "/home/user/old-project",
        project_name: "old-project",
        last_activity: "2026-02-16T00:01:00.000Z",
      }),
      makeSession({
        pane_id: "%1",
        cwd: "/home/user/old-project-worktrees/feat",
        project_name: "old-project",
        last_activity: "2026-02-16T00:06:00.000Z",
      }),
      makeSession({
        pane_id: "%2",
        cwd: "/home/user/new-project",
        project_name: "new-project",
        last_activity: "2026-02-16T00:05:00.000Z",
      }),
      makeSession({
        pane_id: "%3",
        cwd: "/home/user/new-project-worktrees/feat",
        project_name: "new-project",
        last_activity: "2026-02-16T00:04:00.000Z",
      }),
    ];

    const result = groupSessions(sessions);
    expect(result.groups).toHaveLength(2);
    // old-project child has the latest activity (00:06), so old-project group comes first
    expect(result.groups[0].orchestrator?.project_name).toBe("old-project");
    expect(result.groups[1].orchestrator?.project_name).toBe("new-project");
  });
});
