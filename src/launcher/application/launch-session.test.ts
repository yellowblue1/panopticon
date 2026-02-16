import { describe, expect, it } from "bun:test";
import type { LauncherDeps } from "../domain/ports";
import { generateSessionName, launchSession } from "./launch-session";

function createMockDeps(overrides: Partial<LauncherDeps> = {}): LauncherDeps {
  return {
    readDir: () => [],
    isDirectory: () => true,
    pathExists: () => true,
    resolvePath: (p) => p,
    homeDir: () => "/home/test",
    getProjectName: (cwd) => cwd.split("/").pop() ?? "unknown",
    getGitBranch: () => null,
    getGitRemoteUrl: () => null,
    ghqRoot: () => null,
    ghqList: () => [],
    tmuxNewSession: () => "%0",
    tmuxNewWindow: () => "%1",
    tmuxListSessionNames: () => [],
    tmuxSendKeys: () => {},
    readConfig: () => ({ scanPaths: [], useGhq: true }),
    writeConfig: () => {},
    ...overrides,
  };
}

describe("generateSessionName", () => {
  it("generates name from directory basename and agent type", () => {
    expect(generateSessionName("/home/test/src/panopticon", "claude")).toBe("panopticon-claude");
  });

  it("generates name for codex agent", () => {
    expect(generateSessionName("/home/test/src/my-app", "codex")).toBe("my-app-codex");
  });

  it("replaces dots with hyphens", () => {
    expect(generateSessionName("/home/test/src/my.project", "claude")).toBe("my-project-claude");
  });

  it("replaces spaces with hyphens", () => {
    expect(generateSessionName("/home/test/src/my project", "claude")).toBe("my-project-claude");
  });

  it("strips invalid tmux session name characters", () => {
    expect(generateSessionName("/home/test/src/@scope/pkg", "claude")).toBe("pkg-claude");
  });

  it("handles empty basename by falling back to 'session'", () => {
    expect(generateSessionName("/", "claude")).toBe("session-claude");
  });
});

describe("launchSession", () => {
  it("creates a new tmux session when session name does not exist", () => {
    let createdSession: { name: string; cwd: string } | undefined;
    let sentKeys: { paneId: string; text: string } | undefined;

    const deps = createMockDeps({
      tmuxListSessionNames: () => [],
      tmuxNewSession: (name, cwd) => {
        createdSession = { name, cwd };
        return "%0";
      },
      tmuxSendKeys: (paneId, text) => {
        sentKeys = { paneId, text };
      },
    });

    const result = launchSession(
      { projectPath: "/home/test/src/app", agentType: "claude", sessionName: "app-claude" },
      deps,
    );

    expect(result.success).toBe(true);
    expect(result.sessionName).toBe("app-claude");
    expect(result.paneId).toBe("%0");
    expect(result.error).toBeUndefined();
    expect(createdSession).toEqual({ name: "app-claude", cwd: "/home/test/src/app" });
    expect(sentKeys).toEqual({ paneId: "%0", text: "claude" });
  });

  it("creates a new window when session name already exists", () => {
    let createdWindow: { session: string; cwd: string } | undefined;

    const deps = createMockDeps({
      tmuxListSessionNames: () => ["app-claude"],
      tmuxNewWindow: (session, cwd) => {
        createdWindow = { session, cwd };
        return "%5";
      },
      tmuxSendKeys: () => {},
    });

    const result = launchSession(
      { projectPath: "/home/test/src/app", agentType: "codex", sessionName: "app-claude" },
      deps,
    );

    expect(result.success).toBe(true);
    expect(result.paneId).toBe("%5");
    expect(createdWindow).toEqual({ session: "app-claude", cwd: "/home/test/src/app" });
  });

  it("sends the correct agent command (codex)", () => {
    let sentText: string | undefined;

    const deps = createMockDeps({
      tmuxSendKeys: (_paneId, text) => {
        sentText = text;
      },
    });

    launchSession(
      { projectPath: "/home/test/src/app", agentType: "codex", sessionName: "app-codex" },
      deps,
    );

    expect(sentText).toBe("codex");
  });

  it("returns failure when tmux session creation fails", () => {
    const deps = createMockDeps({
      tmuxListSessionNames: () => [],
      tmuxNewSession: () => null,
    });

    const result = launchSession(
      { projectPath: "/home/test/src/app", agentType: "claude", sessionName: "app-claude" },
      deps,
    );

    expect(result.success).toBe(false);
    expect(result.paneId).toBeNull();
    expect(result.error).toBeDefined();
  });

  it("returns failure when tmux window creation fails", () => {
    const deps = createMockDeps({
      tmuxListSessionNames: () => ["existing-session"],
      tmuxNewWindow: () => null,
    });

    const result = launchSession(
      {
        projectPath: "/home/test/src/app",
        agentType: "claude",
        sessionName: "existing-session",
      },
      deps,
    );

    expect(result.success).toBe(false);
    expect(result.paneId).toBeNull();
    expect(result.error).toBeDefined();
  });

  it("does not send keys when pane creation fails", () => {
    let keysSent = false;
    const deps = createMockDeps({
      tmuxNewSession: () => null,
      tmuxSendKeys: () => {
        keysSent = true;
      },
    });

    launchSession(
      { projectPath: "/home/test/src/app", agentType: "claude", sessionName: "app-claude" },
      deps,
    );

    expect(keysSent).toBe(false);
  });
});
