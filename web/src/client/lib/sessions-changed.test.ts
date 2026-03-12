import { describe, expect, it } from "bun:test";
import type { SessionResponse, SessionsApiResponse } from "@shared/types";
import { hasSessionsChanged } from "./sessions-changed";

function makeSession(overrides: Partial<SessionResponse> = {}): SessionResponse {
  return {
    pane_id: "%0",
    project_name: "myproject",
    git_branch: "main",
    github_repo_url: null,
    status: "busy",
    summary: "Working on feature",
    tmux_target: "main:0.0",
    tmux_session_name: "main",
    last_activity: "2026-03-12T10:00:00Z",
    agent_type: "claude",
    cwd: "/home/user/src/myproject",
    ...overrides,
  };
}

function makeResponse(sessions: SessionResponse[], timestamp = 1000): SessionsApiResponse {
  return { sessions, timestamp };
}

describe("hasSessionsChanged", () => {
  it("returns false when sessions are identical", () => {
    const s = makeSession();
    expect(hasSessionsChanged(makeResponse([s]), makeResponse([s]))).toBe(false);
  });

  it("returns false when only last_activity differs", () => {
    const prev = makeResponse([makeSession({ last_activity: "2026-03-12T10:00:00Z" })]);
    const next = makeResponse([makeSession({ last_activity: "2026-03-12T10:00:05Z" })]);
    expect(hasSessionsChanged(prev, next)).toBe(false);
  });

  it("returns false when only timestamp differs", () => {
    const prev = makeResponse([makeSession()], 1000);
    const next = makeResponse([makeSession()], 2000);
    expect(hasSessionsChanged(prev, next)).toBe(false);
  });

  it("returns false for empty sessions on both sides", () => {
    expect(hasSessionsChanged(makeResponse([]), makeResponse([]))).toBe(false);
  });

  it("returns true when session count differs", () => {
    const prev = makeResponse([makeSession()]);
    const next = makeResponse([makeSession(), makeSession({ pane_id: "%1" })]);
    expect(hasSessionsChanged(prev, next)).toBe(true);
  });

  it("returns true when status changes", () => {
    const prev = makeResponse([makeSession({ status: "busy" })]);
    const next = makeResponse([makeSession({ status: "waiting" })]);
    expect(hasSessionsChanged(prev, next)).toBe(true);
  });

  it("returns true when summary changes", () => {
    const prev = makeResponse([makeSession({ summary: "Old summary" })]);
    const next = makeResponse([makeSession({ summary: "New summary" })]);
    expect(hasSessionsChanged(prev, next)).toBe(true);
  });

  it("returns true when summary changes from null", () => {
    const prev = makeResponse([makeSession({ summary: null })]);
    const next = makeResponse([makeSession({ summary: "Generated summary" })]);
    expect(hasSessionsChanged(prev, next)).toBe(true);
  });

  it("returns true when session order changes", () => {
    const s1 = makeSession({ pane_id: "%0" });
    const s2 = makeSession({ pane_id: "%1" });
    const prev = makeResponse([s1, s2]);
    const next = makeResponse([s2, s1]);
    expect(hasSessionsChanged(prev, next)).toBe(true);
  });

  it("returns true when git_branch changes", () => {
    const prev = makeResponse([makeSession({ git_branch: "main" })]);
    const next = makeResponse([makeSession({ git_branch: "feat/new" })]);
    expect(hasSessionsChanged(prev, next)).toBe(true);
  });

  it("returns true when git_branch changes to null", () => {
    const prev = makeResponse([makeSession({ git_branch: "main" })]);
    const next = makeResponse([makeSession({ git_branch: null })]);
    expect(hasSessionsChanged(prev, next)).toBe(true);
  });

  it("returns true when cwd changes", () => {
    const prev = makeResponse([makeSession({ cwd: "/home/user/src/a" })]);
    const next = makeResponse([makeSession({ cwd: "/home/user/src/b" })]);
    expect(hasSessionsChanged(prev, next)).toBe(true);
  });

  it("returns true when project_name changes", () => {
    const prev = makeResponse([makeSession({ project_name: "alpha" })]);
    const next = makeResponse([makeSession({ project_name: "beta" })]);
    expect(hasSessionsChanged(prev, next)).toBe(true);
  });

  it("returns true when agent_type changes", () => {
    const prev = makeResponse([makeSession({ agent_type: "claude" })]);
    const next = makeResponse([makeSession({ agent_type: "codex" })]);
    expect(hasSessionsChanged(prev, next)).toBe(true);
  });

  it("returns true when github_repo_url changes", () => {
    const prev = makeResponse([makeSession({ github_repo_url: null })]);
    const next = makeResponse([makeSession({ github_repo_url: "https://github.com/org/repo" })]);
    expect(hasSessionsChanged(prev, next)).toBe(true);
  });

  it("returns true when tmux_target changes", () => {
    const prev = makeResponse([makeSession({ tmux_target: "main:0.0" })]);
    const next = makeResponse([makeSession({ tmux_target: "main:1.0" })]);
    expect(hasSessionsChanged(prev, next)).toBe(true);
  });

  it("returns true when a session is added", () => {
    const prev = makeResponse([]);
    const next = makeResponse([makeSession()]);
    expect(hasSessionsChanged(prev, next)).toBe(true);
  });

  it("returns true when a session is removed", () => {
    const prev = makeResponse([makeSession()]);
    const next = makeResponse([]);
    expect(hasSessionsChanged(prev, next)).toBe(true);
  });

  it("handles multiple sessions with only last_activity differing", () => {
    const prev = makeResponse([
      makeSession({ pane_id: "%0", last_activity: "2026-03-12T10:00:00Z" }),
      makeSession({ pane_id: "%1", last_activity: "2026-03-12T10:00:01Z" }),
    ]);
    const next = makeResponse([
      makeSession({ pane_id: "%0", last_activity: "2026-03-12T10:00:10Z" }),
      makeSession({ pane_id: "%1", last_activity: "2026-03-12T10:00:11Z" }),
    ]);
    expect(hasSessionsChanged(prev, next)).toBe(false);
  });
});
