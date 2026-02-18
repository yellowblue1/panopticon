import { describe, expect, it } from "bun:test";
import type { SessionResponse } from "@shared/types";
import { applyLockedOrder, captureOrder, type LockedOrder } from "./sort-lock";

function makeSession(overrides: Partial<SessionResponse> & { cwd: string }): SessionResponse {
  return {
    pane_id: "%0",
    project_name: "myproject",
    git_branch: "main",
    github_repo_url: null,
    status: "busy",
    summary: null,
    tmux_target: "main:0.0",
    last_activity: "2026-02-16T00:00:00.000Z",
    agent_type: "claude",
    ...overrides,
  };
}

describe("captureOrder", () => {
  it("extracts pane IDs from groups and ungrouped", () => {
    const result = captureOrder({
      groups: [
        {
          orchestrator: makeSession({ pane_id: "%0", cwd: "/home/user/proj" }),
          children: [
            makeSession({ pane_id: "%1", cwd: "/home/user/proj-worktrees/feat-a" }),
            makeSession({ pane_id: "%2", cwd: "/home/user/proj-worktrees/feat-b" }),
          ],
        },
        {
          orchestrator: null,
          children: [makeSession({ pane_id: "%3", cwd: "/home/user/other-worktrees/fix" })],
        },
      ],
      ungrouped: [makeSession({ pane_id: "%4", cwd: "/home/user/standalone" })],
    });

    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].orchestratorPaneId).toBe("%0");
    expect(result.groups[0].childPaneIds).toEqual(["%1", "%2"]);
    expect(result.groups[1].orchestratorPaneId).toBeNull();
    expect(result.groups[1].childPaneIds).toEqual(["%3"]);
    expect(result.ungroupedPaneIds).toEqual(["%4"]);
  });
});

describe("applyLockedOrder", () => {
  it("preserves order with identical sessions", () => {
    const order: LockedOrder = {
      groups: [
        {
          orchestratorPaneId: "%0",
          childPaneIds: ["%1", "%2"],
        },
      ],
      ungroupedPaneIds: ["%3"],
    };

    const sessions = [
      makeSession({ pane_id: "%0", cwd: "/home/user/proj" }),
      makeSession({ pane_id: "%1", cwd: "/home/user/proj-worktrees/feat-a" }),
      makeSession({ pane_id: "%2", cwd: "/home/user/proj-worktrees/feat-b" }),
      makeSession({ pane_id: "%3", cwd: "/home/user/standalone" }),
    ];

    const result = applyLockedOrder(order, sessions);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].orchestrator?.pane_id).toBe("%0");
    expect(result.groups[0].children.map((c) => c.pane_id)).toEqual(["%1", "%2"]);
    expect(result.ungrouped.map((s) => s.pane_id)).toEqual(["%3"]);
  });

  it("filters out removed sessions", () => {
    const order: LockedOrder = {
      groups: [
        {
          orchestratorPaneId: "%0",
          childPaneIds: ["%1", "%2"],
        },
      ],
      ungroupedPaneIds: ["%3"],
    };

    // %2 and %3 are gone
    const sessions = [
      makeSession({ pane_id: "%0", cwd: "/home/user/proj" }),
      makeSession({ pane_id: "%1", cwd: "/home/user/proj-worktrees/feat-a" }),
    ];

    const result = applyLockedOrder(order, sessions);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].children.map((c) => c.pane_id)).toEqual(["%1"]);
    expect(result.ungrouped).toHaveLength(0);
  });

  it("appends new sessions to ungrouped", () => {
    const order: LockedOrder = {
      groups: [],
      ungroupedPaneIds: ["%0"],
    };

    const sessions = [
      makeSession({ pane_id: "%0", cwd: "/home/user/proj-a" }),
      makeSession({ pane_id: "%1", cwd: "/home/user/proj-b" }),
    ];

    const result = applyLockedOrder(order, sessions);

    expect(result.ungrouped.map((s) => s.pane_id)).toEqual(["%0", "%1"]);
  });

  it("removes entire group when all members disappear", () => {
    const order: LockedOrder = {
      groups: [
        {
          orchestratorPaneId: "%0",
          childPaneIds: ["%1"],
        },
      ],
      ungroupedPaneIds: ["%2"],
    };

    // Only %2 remains
    const sessions = [makeSession({ pane_id: "%2", cwd: "/home/user/standalone" })];

    const result = applyLockedOrder(order, sessions);

    expect(result.groups).toHaveLength(0);
    expect(result.ungrouped.map((s) => s.pane_id)).toEqual(["%2"]);
  });

  it("uses fresh session data, not stale data", () => {
    const order: LockedOrder = {
      groups: [],
      ungroupedPaneIds: ["%0"],
    };

    const sessions = [
      makeSession({
        pane_id: "%0",
        cwd: "/home/user/proj",
        status: "waiting",
        summary: "Updated summary",
        last_activity: "2026-02-16T01:00:00.000Z",
      }),
    ];

    const result = applyLockedOrder(order, sessions);

    expect(result.ungrouped[0].status).toBe("waiting");
    expect(result.ungrouped[0].summary).toBe("Updated summary");
    expect(result.ungrouped[0].last_activity).toBe("2026-02-16T01:00:00.000Z");
  });

  it("handles empty locked order", () => {
    const order: LockedOrder = {
      groups: [],
      ungroupedPaneIds: [],
    };

    const sessions = [makeSession({ pane_id: "%0", cwd: "/home/user/proj" })];

    const result = applyLockedOrder(order, sessions);

    expect(result.groups).toHaveLength(0);
    expect(result.ungrouped.map((s) => s.pane_id)).toEqual(["%0"]);
  });

  it("keeps group alive when orchestrator is removed but children remain", () => {
    const order: LockedOrder = {
      groups: [
        {
          orchestratorPaneId: "%0",
          childPaneIds: ["%1", "%2"],
        },
      ],
      ungroupedPaneIds: [],
    };

    // Orchestrator gone, children remain
    const sessions = [
      makeSession({ pane_id: "%1", cwd: "/home/user/proj-worktrees/feat-a" }),
      makeSession({ pane_id: "%2", cwd: "/home/user/proj-worktrees/feat-b" }),
    ];

    const result = applyLockedOrder(order, sessions);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].orchestrator).toBeNull();
    expect(result.groups[0].children.map((c) => c.pane_id)).toEqual(["%1", "%2"]);
  });
});
