import { afterEach, describe, expect, it, mock } from "bun:test";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type { MonitoredProcess, ProcessInfo, TmuxPane } from "../../terminal/domain/types";
import type { SessionManagerDeps } from "../domain/ports";
import { SessionManager } from "./session-manager";

/**
 * Mock FIFO reader process that allows simulating pipe-pane output
 */
class MockFifoReader extends EventEmitter {
  stdout: EventEmitter = new EventEmitter();
  killed = false;
  killSignals: string[] = [];

  kill(signal?: string): boolean {
    this.killSignals.push(signal ?? "SIGTERM");
    this.killed = true;
    return true;
  }

  /** Simulate data arriving from pipe-pane */
  simulateData(data = "output"): void {
    this.stdout.emit("data", Buffer.from(data));
  }

  /** Simulate reader process exiting (e.g. pane destroyed → FIFO EOF) */
  simulateExit(code = 0): void {
    this.emit("exit", code, null);
  }
}

function createMockDeps(overrides: Partial<SessionManagerDeps> = {}): {
  deps: SessionManagerDeps;
  fifoReaders: Map<string, MockFifoReader>;
} {
  const defaultPanes: TmuxPane[] = [
    {
      pane_id: "%0",
      pane_pid: 1000,
      session_name: "main",
      window_index: 0,
      pane_index: 0,
      window_name: "main",
    },
  ];
  const defaultProcesses: MonitoredProcess[] = [{ pid: 2000, ppid: 1000, binaryName: "claude" }];
  const defaultProcessTable: ProcessInfo[] = [
    { pid: 1000, ppid: 1, command: "-bash" },
    { pid: 2000, ppid: 1000, command: "claude" },
  ];
  const fifoReaders = new Map<string, MockFifoReader>();

  const deps: SessionManagerDeps = {
    isTmuxAvailable: () => true,
    getAllTmuxPanes: () => defaultPanes,
    getProcessTable: () => defaultProcessTable,
    getMonitoredProcesses: () => defaultProcesses,
    getProcessCwd: () => "/home/user/project",
    getProcessStartTime: () => "2023-11-14T22:13:20.000Z",
    getProjectName: () => "my-project",
    getGitRemoteUrl: () => "https://github.com/user/my-project",
    buildTmuxTarget: (pane) => `${pane.session_name}:${pane.window_index}.${pane.pane_index}`,
    matchProcessesToPanes: (processes, panes, _processTable) => {
      const paneByPid = new Map<number, TmuxPane>();
      for (const pane of panes) paneByPid.set(pane.pane_pid, pane);
      const result = new Map<string, { process: MonitoredProcess; pane: TmuxPane }>();
      for (const proc of processes) {
        const pane = paneByPid.get(proc.ppid);
        if (pane) result.set(pane.pane_id, { process: proc, pane });
      }
      return result;
    },
    generateSummary: async () => null,
    capturePaneContent: () => null,
    capturePaneContentForSummary: () => null,
    startPipePane: () => true,
    stopPipePane: () => true,
    createFifo: () => true,
    spawnFifoReader: (path: string) => {
      const reader = new MockFifoReader();
      fifoReaders.set(path, reader);
      return reader as unknown as ChildProcess;
    },
    ...overrides,
    // Auto-link: if capturePaneContent is overridden but capturePaneContentForSummary is not,
    // default the latter to the former (minimizes changes to existing tests)
    ...(overrides.capturePaneContent && !overrides.capturePaneContentForSummary
      ? { capturePaneContentForSummary: overrides.capturePaneContent }
      : {}),
  };

  return { deps, fifoReaders };
}

describe("SessionManager", () => {
  let manager: SessionManager;

  afterEach(() => {
    manager?.stop();
  });

  describe("getSessions", () => {
    it("returns empty array when no sessions detected", () => {
      const { deps } = createMockDeps({
        getMonitoredProcesses: () => [],
      });
      manager = new SessionManager(deps);
      manager.start();
      expect(manager.getSessions()).toEqual([]);
    });

    it("detects a claude session from tmux pane", () => {
      const { deps } = createMockDeps();
      manager = new SessionManager(deps);
      manager.start();

      const sessions = manager.getSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].pane_id).toBe("%0");
      expect(sessions[0].project_name).toBe("my-project");
      expect(sessions[0].window_name).toBe("main");
      expect(sessions[0].status).toBe("busy");
      expect(sessions[0].tmux_target).toBe("main:0.0");
      expect(sessions[0].tmux_session_name).toBe("main");
      expect(sessions[0].agent_type).toBe("claude");
    });

    it("exposes agent_type from binaryName in session response", () => {
      const { deps } = createMockDeps({
        getMonitoredProcesses: () => [{ pid: 2000, ppid: 1000, binaryName: "codex" }],
      });
      manager = new SessionManager(deps);
      manager.start();

      const sessions = manager.getSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].agent_type).toBe("codex");
    });

    it("falls back to pane_pid cwd when monitored process cwd is unreadable", () => {
      // nori-cli runs hardened, so /proc/<pid>/cwd is permission-denied for
      // the agent process itself; the pane shell (pane_pid) is always readable.
      const { deps } = createMockDeps({
        getMonitoredProcesses: () => [{ pid: 2000, ppid: 1000, binaryName: "nori" }],
        getProcessCwd: (pid) => (pid === 1000 ? "/home/user/project" : null),
      });
      manager = new SessionManager(deps);
      manager.start();

      const sessions = manager.getSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].agent_type).toBe("nori");
      expect(sessions[0].cwd).toBe("/home/user/project");
    });

    it("prefers the agent process cwd over the pane shell cwd", () => {
      // Agent cwd is frozen at exec time; pane shell cwd may have moved if
      // the user `cd`s after launch. Use the agent's so project_name/branch
      // stay accurate.
      const { deps } = createMockDeps({
        getProcessCwd: (pid) => (pid === 2000 ? "/home/user/agent-cwd" : "/home/user/shell-cwd"),
      });
      manager = new SessionManager(deps);
      manager.start();

      expect(manager.getSessions()[0].cwd).toBe("/home/user/agent-cwd");
    });

    it("ignores unrecognized binary names", () => {
      const { deps } = createMockDeps({
        getMonitoredProcesses: () => [{ pid: 2000, ppid: 1000, binaryName: "rogue" }],
      });
      manager = new SessionManager(deps);
      manager.start();

      expect(manager.getSessions()).toHaveLength(0);
    });
  });

  describe("idle detection via pipe-pane", () => {
    it("marks session as WAITING after idle threshold", async () => {
      const { deps } = createMockDeps();
      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 100,
      });
      manager.start();

      // Initially BUSY
      expect(manager.getSessions()[0]?.status).toBe("busy");

      // Wait for idle threshold to expire
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should now be WAITING (no pipe-pane data)
      expect(manager.getSessions()[0]?.status).toBe("waiting");
    });

    it("transitions to WAITING even when pipe-pane receives data (ANSI noise)", async () => {
      const { deps, fifoReaders } = createMockDeps();
      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 200,
      });
      manager.start();

      // Simulate pipe-pane data every 50ms (faster than idle threshold)
      const reader = Array.from(fifoReaders.values())[0];
      const interval = setInterval(() => {
        reader?.simulateData("output");
      }, 50);

      await new Promise((resolve) => setTimeout(resolve, 400));
      clearInterval(interval);

      // Pipe-pane data alone (ANSI noise) should NOT prevent WAITING transition
      expect(manager.getSessions()[0]?.status).toBe("waiting");
    });

    it("stays BUSY when visible content keeps changing", async () => {
      let callCount = 0;
      const { deps } = createMockDeps({
        capturePaneContent: () => `content ${callCount++}`,
      });
      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 100,
        paneCheckIntervalMs: 30,
      });
      manager.start();

      await new Promise((resolve) => setTimeout(resolve, 300));

      // Should still be BUSY because visible content keeps changing
      expect(manager.getSessions()[0]?.status).toBe("busy");
    });

    it("transitions back to BUSY when pane content changes after WAITING", async () => {
      let paneContent = "initial content";
      const { deps } = createMockDeps({
        capturePaneContent: () => paneContent,
      });
      const onChangeSpy = mock(() => {});

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 100,
        paneCheckIntervalMs: 30,
      });
      manager.onChange(onChangeSpy);
      manager.start();

      // Wait for idle
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(manager.getSessions()[0]?.status).toBe("waiting");

      // Simulate pane content change (Claude starts outputting)
      paneContent = "new output from Claude";
      await new Promise((resolve) => setTimeout(resolve, 80));

      // Should be back to BUSY
      expect(manager.getSessions()[0]?.status).toBe("busy");
    });

    it("resets idle timer when pane content changes during BUSY", async () => {
      let contentVersion = 0;
      const { deps } = createMockDeps({
        capturePaneContent: () => `content v${contentVersion}`,
      });
      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 150,
        paneCheckIntervalMs: 30,
      });
      manager.start();

      // Initially BUSY
      expect(manager.getSessions()[0]?.status).toBe("busy");

      // At 100ms, change content (before 150ms idle threshold)
      await new Promise((resolve) => setTimeout(resolve, 100));
      contentVersion = 1;

      // At 200ms (100ms after content change, within 150ms of last detected change)
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(manager.getSessions()[0]?.status).toBe("busy");

      // Stop changing content — idle timer should fire
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(manager.getSessions()[0]?.status).toBe("waiting");
    });
  });

  describe("session removal", () => {
    it("removes sessions when process disappears", async () => {
      let hasProcess = true;
      const { deps } = createMockDeps({
        getMonitoredProcesses: () =>
          hasProcess ? [{ pid: 2000, ppid: 1000, binaryName: "claude" }] : [],
      });

      manager = new SessionManager(deps, { pollIntervalMs: 50 });
      manager.start();

      expect(manager.getSessions()).toHaveLength(1);

      // Remove the process
      hasProcess = false;
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(manager.getSessions()).toHaveLength(0);
    });
  });

  describe("PID change detection", () => {
    it("recreates session when monitored process PID changes in same pane", async () => {
      let currentPid = 2000;
      const { deps } = createMockDeps({
        getMonitoredProcesses: () => [{ pid: currentPid, ppid: 1000, binaryName: "claude" }],
        getAllTmuxPanes: () => [
          {
            pane_id: "%0",
            pane_pid: 1000,
            session_name: "main",
            window_index: 0,
            pane_index: 0,
            window_name: currentPid === 2000 ? "feature-a" : "feature-b",
          },
        ],
        getProcessCwd: () =>
          currentPid === 2000 ? "/home/user/project-a" : "/home/user/project-b",
      });

      manager = new SessionManager(deps, { pollIntervalMs: 50 });
      manager.start();

      // Initial session
      expect(manager.getSessions()).toHaveLength(1);
      expect(manager.getSessions()[0].window_name).toBe("feature-a");

      // Claude restarts with a different PID in the same pane
      currentPid = 3000;
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Session should be recreated with fresh metadata
      const sessions = manager.getSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].window_name).toBe("feature-b");
      expect(sessions[0].pane_id).toBe("%0");
    });

    it("fires onChange when PID changes", async () => {
      let currentPid = 2000;
      const onChangeSpy = mock(() => {});
      const { deps } = createMockDeps({
        getMonitoredProcesses: () => [{ pid: currentPid, ppid: 1000, binaryName: "claude" }],
      });

      manager = new SessionManager(deps, { pollIntervalMs: 50 });
      manager.onChange(onChangeSpy);
      manager.start();

      const initialCallCount = onChangeSpy.mock.calls.length;

      currentPid = 3000;
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should have fired at least once more for the PID change
      expect(onChangeSpy.mock.calls.length).toBeGreaterThan(initialCallCount);
    });

    it("recreates session with fresh metadata when PID changes during WAITING", async () => {
      let currentPid = 2000;
      const { deps } = createMockDeps({
        getMonitoredProcesses: () => [{ pid: currentPid, ppid: 1000, binaryName: "claude" }],
        getAllTmuxPanes: () => [
          {
            pane_id: "%0",
            pane_pid: 1000,
            session_name: "main",
            window_index: 0,
            pane_index: 0,
            window_name: currentPid === 2000 ? "old-window" : "new-window",
          },
        ],
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 50,
        idleThresholdMs: 30,
      });
      manager.start();

      // Wait for WAITING status
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(manager.getSessions()[0]?.status).toBe("waiting");
      expect(manager.getSessions()[0]?.window_name).toBe("old-window");

      // PID change: new Claude starts
      currentPid = 3000;
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Session should be recreated with fresh metadata
      expect(manager.getSessions()[0]?.window_name).toBe("new-window");
    });

    it("does not recreate session when PID remains the same", async () => {
      const getProcessCwdSpy = mock(() => "/home/user/project");
      const { deps } = createMockDeps({
        getProcessCwd: getProcessCwdSpy,
      });

      manager = new SessionManager(deps, { pollIntervalMs: 50 });
      manager.start();

      const initialCallCount = getProcessCwdSpy.mock.calls.length;

      // Wait for several polls
      await new Promise((resolve) => setTimeout(resolve, 200));

      // getProcessCwd should not be called again (no recreation)
      expect(getProcessCwdSpy.mock.calls.length).toBe(initialCallCount);
    });
  });

  describe("tmux unavailable", () => {
    it("returns empty sessions when tmux is not available", () => {
      const { deps } = createMockDeps({
        isTmuxAvailable: () => false,
      });
      manager = new SessionManager(deps);
      manager.start();
      expect(manager.getSessions()).toEqual([]);
    });
  });

  describe("getSession", () => {
    it("returns session by pane ID", () => {
      const { deps } = createMockDeps();
      manager = new SessionManager(deps);
      manager.start();

      const session = manager.getSession("%0");
      expect(session).not.toBeNull();
      expect(session?.pane_id).toBe("%0");
    });

    it("returns null for unknown pane ID", () => {
      const { deps } = createMockDeps();
      manager = new SessionManager(deps);
      manager.start();

      expect(manager.getSession("%99")).toBeNull();
    });
  });

  describe("onChange callback", () => {
    it("fires when new session is discovered", () => {
      const onChangeSpy = mock(() => {});
      const { deps } = createMockDeps();
      manager = new SessionManager(deps);
      manager.onChange(onChangeSpy);
      manager.start();

      expect(onChangeSpy).toHaveBeenCalled();
    });

    it("fires when session is removed", async () => {
      const onChangeSpy = mock(() => {});
      let hasProcess = true;

      const { deps } = createMockDeps({
        getMonitoredProcesses: () =>
          hasProcess ? [{ pid: 2000, ppid: 1000, binaryName: "claude" }] : [],
      });

      manager = new SessionManager(deps, { pollIntervalMs: 50 });
      manager.onChange(onChangeSpy);
      manager.start();

      hasProcess = false;
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should have been called at least twice: once for discovery, once for removal
      expect(onChangeSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("fires when session transitions to WAITING", async () => {
      const onChangeSpy = mock(() => {});
      const { deps } = createMockDeps();

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 100,
      });
      manager.onChange(onChangeSpy);
      manager.start();

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Called for: discovery + waiting transition
      expect(onChangeSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("summary generation (sustained WAITING)", () => {
    it("triggers summary only after sustained WAITING period", async () => {
      const generateSpy = mock(async () => "Waiting for user approval");

      const { deps } = createMockDeps({
        generateSummary: generateSpy,
        capturePaneContent: () => "static pane content",
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 50,
        summaryDelayMs: 150,
      });
      manager.start();

      // After idle threshold (50ms): WAITING but no Gemini call yet
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(manager.getSessions()[0]?.status).toBe("waiting");
      expect(generateSpy).not.toHaveBeenCalled();

      // After summary delay (50 + 150 = 200ms total): Gemini called
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(generateSpy).toHaveBeenCalledTimes(1);
      expect(manager.getSessions()[0]?.summary).toBe("Waiting for user approval");
    });

    it("cancels summary when session goes BUSY before delay fires", async () => {
      const generateSpy = mock(async () => "Should not appear");
      let contentCounter = 0;
      let paneContent = "initial content";

      const { deps } = createMockDeps({
        generateSummary: generateSpy,
        capturePaneContent: () => paneContent,
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 50,
        summaryDelayMs: 200,
        paneCheckIntervalMs: 30,
      });
      manager.start();

      // Wait for WAITING (50ms idle threshold)
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(manager.getSessions()[0]?.status).toBe("waiting");
      // Summary timer started at ~T=50, would fire at ~T=250

      // Go BUSY before summary delay fires via continuous content changes
      const interval = setInterval(() => {
        paneContent = `output ${++contentCounter}`;
      }, 20);
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(manager.getSessions()[0]?.status).toBe("busy");
      clearInterval(interval);

      // Content now static. Session will go WAITING at ~T=230 (T=180+50ms idle).
      // New summary timer starts at T=230, would fire at T=430.
      // Check at T=250 (original summary time): no Gemini call.
      await new Promise((resolve) => setTimeout(resolve, 70));
      expect(generateSpy).not.toHaveBeenCalled();
    });

    it("does not call Gemini during brief BUSY↔WAITING cycling", async () => {
      const generateSpy = mock(async () => "test");
      let paneContent = "initial content";

      const { deps } = createMockDeps({
        generateSummary: generateSpy,
        capturePaneContent: () => paneContent,
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 30,
        summaryDelayMs: 200,
        paneCheckIntervalMs: 30,
      });
      manager.start();

      // Rapid BUSY↔WAITING cycling: go idle, then change content, repeat
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50)); // idle → WAITING
        paneContent = `output ${i}`; // → content change → BUSY (cancels summary timer)
        await new Promise((resolve) => setTimeout(resolve, 50)); // wait for pane check
      }

      // Wait past summary delay
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Only the LAST sustained WAITING should trigger Gemini.
      expect(generateSpy).toHaveBeenCalledTimes(1);
    });

    it("passes pane content to generateSummary as primary source", async () => {
      const paneText = "$ claude\n> Fix the bug\nDone. Waiting for input.";
      const receivedContents: string[] = [];

      const { deps } = createMockDeps({
        capturePaneContent: () => paneText,
        generateSummary: async (content) => {
          receivedContents.push(content);
          return "Fixed a bug";
        },
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 50,
        summaryDelayMs: 50,
        paneCheckIntervalMs: 5000, // Disable pane check to use summaryDelay
      });
      manager.start();

      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(receivedContents).toHaveLength(1);
      expect(receivedContents[0]).toBe(paneText);
    });

    it("does not generate summary when pane content is null", async () => {
      const generateSpy = mock(async () => "test");

      const { deps } = createMockDeps({
        capturePaneContent: () => null,
        generateSummary: generateSpy,
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 50,
        summaryDelayMs: 50,
      });
      manager.start();

      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(generateSpy).not.toHaveBeenCalled();
    });

    it("does not call generateSummary twice in the same WAITING period", async () => {
      const generateSpy = mock(async () => {
        // Simulate slow Gemini response
        await new Promise((resolve) => setTimeout(resolve, 200));
        return "Summary result";
      });

      const { deps } = createMockDeps({
        generateSummary: generateSpy,
        capturePaneContent: () => "static content",
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 30,
        summaryDelayMs: 60,
        paneCheckIntervalMs: 30,
      });
      manager.start();

      // Wait for idle + summary delay + Gemini response
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Should only call Gemini once via summary timer
      expect(generateSpy).toHaveBeenCalledTimes(1);
    });

    it("uses capturePaneContentForSummary instead of capturePaneContent for summary generation", async () => {
      const paneContentSpy = mock(() => "raw pane content");
      const sanitizedSpy = mock(() => "sanitized pane content");
      const receivedContents: string[] = [];

      const { deps } = createMockDeps({
        capturePaneContent: paneContentSpy,
        capturePaneContentForSummary: sanitizedSpy,
        generateSummary: async (content) => {
          receivedContents.push(content);
          return "Summary";
        },
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 50,
        summaryDelayMs: 50,
        paneCheckIntervalMs: 5000,
      });
      manager.start();

      await new Promise((resolve) => setTimeout(resolve, 250));

      // generateSummary should receive sanitized content, not raw
      expect(receivedContents).toHaveLength(1);
      expect(receivedContents[0]).toBe("sanitized pane content");
      expect(sanitizedSpy).toHaveBeenCalled();
    });
  });

  describe("dual-condition idle detection (pane diff + JSONL idle)", () => {
    it("triggers summary only after summaryDelay even when pane is static", async () => {
      const generateSpy = mock(async () => "Waiting for approval");

      const { deps } = createMockDeps({
        generateSummary: generateSpy,
        capturePaneContent: () => "static pane content",
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 50,
        summaryDelayMs: 200,
        paneCheckIntervalMs: 30,
      });
      manager.start();

      // After idle threshold (50ms) but before summaryDelay (200ms): no summary yet
      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(generateSpy).not.toHaveBeenCalled();

      // After summaryDelay fires: summary generated
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(generateSpy).toHaveBeenCalledTimes(1);
      expect(manager.getSessions()[0]?.summary).toBe("Waiting for approval");
    });

    it("does not trigger immediate summary when pane content is changing", async () => {
      const generateSpy = mock(async () => "test");
      let callCount = 0;

      const { deps } = createMockDeps({
        generateSummary: generateSpy,
        capturePaneContent: () => `pane content ${callCount++}`,
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 50,
        summaryDelayMs: 5000,
        paneCheckIntervalMs: 30,
      });
      manager.start();

      // Wait well past idle threshold but not near summaryDelay
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Pane content keeps changing, so summary timer keeps getting cancelled
      expect(generateSpy).not.toHaveBeenCalled();
    });

    it("falls back to summaryDelay when capturePaneContent returns null", async () => {
      const generateSpy = mock(async () => "Fallback summary");

      const { deps } = createMockDeps({
        generateSummary: generateSpy,
        capturePaneContent: () => null,
        capturePaneContentForSummary: () => "summary content from sanitized capture",
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 50,
        summaryDelayMs: 150,
        paneCheckIntervalMs: 30,
      });
      manager.start();

      // After idle threshold but before summaryDelay: no summary yet
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(generateSpy).not.toHaveBeenCalled();

      // After summaryDelay fires: summary generated via fallback
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(generateSpy).toHaveBeenCalledTimes(1);
    });

    it("does not trigger on first pane check (previousPaneContent is null)", async () => {
      const generateSpy = mock(async () => "test");
      let firstCall = true;

      const { deps } = createMockDeps({
        generateSummary: generateSpy,
        // Return same content but first capture should not count as "static"
        capturePaneContent: () => {
          if (firstCall) {
            firstCall = false;
            return "initial content";
          }
          // Return different content after first call to prevent trigger
          return `changing ${Date.now()}`;
        },
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 50,
        summaryDelayMs: 5000,
        paneCheckIntervalMs: 30,
      });
      manager.start();

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should NOT have triggered — first check has null previousPaneContent,
      // and subsequent checks return different content
      expect(generateSpy).not.toHaveBeenCalled();
    });
  });

  describe("capture-pane fallback BUSY detection (when pipe-pane unavailable)", () => {
    it("transitions from WAITING to BUSY when pane content changes", async () => {
      let paneContent = "initial content";
      const { deps } = createMockDeps({
        createFifo: () => false, // pipe-pane unavailable
        capturePaneContent: () => paneContent,
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 200,
        paneCheckIntervalMs: 30,
        summaryDelayMs: 5000,
      });
      manager.start();

      // Wait for idle threshold to expire → WAITING
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(manager.getSessions()[0]?.status).toBe("waiting");

      // Simulate pane content change (Claude is thinking)
      paneContent = "thinking... spinner frame 1";
      // Wait for pane check to detect change, but less than idleThresholdMs (200ms)
      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(manager.getSessions()[0]?.status).toBe("busy");
    });

    it("resets idle timer on content change in fallback mode", async () => {
      let paneContent = "initial content";
      const { deps } = createMockDeps({
        createFifo: () => false, // pipe-pane unavailable
        capturePaneContent: () => paneContent,
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 150,
        paneCheckIntervalMs: 30,
        summaryDelayMs: 5000,
      });
      manager.start();

      // Initially BUSY, send content changes to keep resetting idle timer
      await new Promise((resolve) => setTimeout(resolve, 100));
      paneContent = "content 2";
      await new Promise((resolve) => setTimeout(resolve, 100));
      paneContent = "content 3";
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should still be BUSY — content changes keep resetting the idle timer
      expect(manager.getSessions()[0]?.status).toBe("busy");
    });

    it("fires onChange when pane content change triggers WAITING → BUSY", async () => {
      let paneContent = "initial";
      const onChangeSpy = mock(() => {});

      const { deps } = createMockDeps({
        createFifo: () => false, // pipe-pane unavailable
        capturePaneContent: () => paneContent,
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 200,
        paneCheckIntervalMs: 30,
        summaryDelayMs: 5000,
      });
      manager.onChange(onChangeSpy);
      manager.start();

      // Wait for WAITING
      await new Promise((resolve) => setTimeout(resolve, 300));
      const countAfterWaiting = onChangeSpy.mock.calls.length;

      // Pane content changes
      paneContent = "changed content";
      // Wait for pane check to detect change, but less than idleThresholdMs (200ms)
      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(onChangeSpy.mock.calls.length).toBeGreaterThan(countAfterWaiting);
    });

    it("triggers BUSY on content change even when pipe-pane is active (redundant detection)", async () => {
      let paneContent = "initial content";
      const { deps } = createMockDeps({
        // pipe-pane is active (default: createFifo returns true)
        capturePaneContent: () => paneContent,
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 50,
        paneCheckIntervalMs: 30,
        summaryDelayMs: 5000,
      });
      manager.start();

      // Wait for WAITING + at least one pane check to establish previousPaneContent
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(manager.getSessions()[0]?.status).toBe("waiting");

      // Pane content changes — capture-pane should trigger BUSY even with pipe-pane active.
      // Keep content changing so idle timer doesn't transition back to WAITING.
      paneContent = "changed content";

      // Wait for capture-pane to detect the change (within 1 paneCheckInterval)
      await new Promise((resolve) => setTimeout(resolve, 40));

      // Check status transitioned to BUSY via capture-pane content change detection
      const status = manager.getSessions()[0]?.status;
      expect(status).toBe("busy");
    });

    it("does not transition to BUSY when pane content is static", async () => {
      const { deps } = createMockDeps({
        createFifo: () => false,
        capturePaneContent: () => "always the same",
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 50,
        paneCheckIntervalMs: 30,
        summaryDelayMs: 5000,
      });
      manager.start();

      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(manager.getSessions()[0]?.status).toBe("waiting");
    });

    it("does not false-trigger BUSY on first pane capture", async () => {
      const { deps } = createMockDeps({
        createFifo: () => false,
        capturePaneContent: () => "some content",
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 50,
        paneCheckIntervalMs: 30,
        summaryDelayMs: 5000,
      });
      manager.start();

      // First capture has null previousPaneContent — should not trigger BUSY
      // Session should still proceed to WAITING via idle timer
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(manager.getSessions()[0]?.status).toBe("waiting");
    });

    it("recovers from BUSY state via checkPaneContent safety net", async () => {
      let paneContent = "initial content";
      const { deps } = createMockDeps({
        createFifo: () => false,
        capturePaneContent: () => paneContent,
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 200,
        paneCheckIntervalMs: 30,
        summaryDelayMs: 5000,
      });
      manager.start();

      // Wait for WAITING
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(manager.getSessions()[0]?.status).toBe("waiting");

      // Trigger BUSY via content change
      paneContent = "changed content";
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(manager.getSessions()[0]?.status).toBe("busy");

      // Content is now static — idle timer from the content change should
      // transition back to WAITING. This also validates the safety net:
      // if the timer was somehow lost, checkPaneContent would restart it.
      await new Promise((resolve) => setTimeout(resolve, 350));
      expect(manager.getSessions()[0]?.status).toBe("waiting");
    });
  });

  describe("pipe-pane activity detection", () => {
    it("sets up pipe-pane on session creation", () => {
      const createFifoSpy = mock(() => true);
      const startPipePaneSpy = mock(() => true);

      const { deps } = createMockDeps({
        createFifo: createFifoSpy,
        startPipePane: startPipePaneSpy,
      });

      manager = new SessionManager(deps, { pollIntervalMs: 5000 });
      manager.start();

      expect(createFifoSpy).toHaveBeenCalledTimes(1);
      expect(startPipePaneSpy).toHaveBeenCalledTimes(1);
    });

    it("does not transition from WAITING to BUSY on pipe-pane data alone", async () => {
      const { deps, fifoReaders } = createMockDeps();

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 50,
        paneCheckIntervalMs: 5000,
      });
      manager.start();

      // Wait for WAITING
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(manager.getSessions()[0]?.status).toBe("waiting");

      // Simulate pipe-pane data (ANSI noise)
      const reader = Array.from(fifoReaders.values())[0];
      reader?.simulateData("some output");

      // Should stay WAITING — pipe-pane data does not drive status transitions
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(manager.getSessions()[0]?.status).toBe("waiting");
    });

    it("returns null summary via API when content change triggers BUSY (cached internally)", async () => {
      const generateSpy = mock(async () => "Some summary");
      let paneContent = "static content";
      let callCount = 0;

      const { deps } = createMockDeps({
        generateSummary: generateSpy,
        capturePaneContent: () => paneContent,
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 50,
        paneCheckIntervalMs: 30,
        summaryDelayMs: 100,
      });
      manager.start();

      // Wait for WAITING + summary delay → summary generated
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(manager.getSessions()[0]?.status).toBe("waiting");
      expect(manager.getSessions()[0]?.summary).toBe("Some summary");

      // Keep changing content so session stays BUSY
      paneContent = "new output from Claude";
      const interval = setInterval(() => {
        paneContent = `new output ${++callCount}`;
      }, 20);

      await new Promise((resolve) => setTimeout(resolve, 80));
      clearInterval(interval);

      expect(manager.getSessions()[0]?.status).toBe("busy");
      // API should return null summary for BUSY sessions
      expect(manager.getSessions()[0]?.summary).toBeNull();
      expect(manager.getSession("%0")?.summary).toBeNull();
    });

    it("fires onChange when content change triggers WAITING → BUSY", async () => {
      let paneContent = "initial content";
      const onChangeSpy = mock(() => {});

      const { deps } = createMockDeps({
        capturePaneContent: () => paneContent,
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 50,
        paneCheckIntervalMs: 30,
      });
      manager.onChange(onChangeSpy);
      manager.start();

      // Wait for WAITING
      await new Promise((resolve) => setTimeout(resolve, 100));
      const countAfterWaiting = onChangeSpy.mock.calls.length;

      // Content change
      paneContent = "new content from Claude";
      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(onChangeSpy.mock.calls.length).toBeGreaterThan(countAfterWaiting);
    });

    it("tears down pipe-pane on session removal", async () => {
      let hasProcess = true;
      const stopPipePaneSpy = mock(() => true);

      const { deps, fifoReaders } = createMockDeps({
        getMonitoredProcesses: () =>
          hasProcess ? [{ pid: 2000, ppid: 1000, binaryName: "claude" }] : [],
        stopPipePane: stopPipePaneSpy,
      });

      manager = new SessionManager(deps, { pollIntervalMs: 50 });
      manager.start();

      expect(fifoReaders.size).toBe(1);
      const reader = Array.from(fifoReaders.values())[0];

      // Remove process
      hasProcess = false;
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(stopPipePaneSpy).toHaveBeenCalled();
      expect(reader?.killed).toBe(true);
    });

    it("tears down pipe-pane on stop", () => {
      const stopPipePaneSpy = mock(() => true);

      const { deps, fifoReaders } = createMockDeps({
        stopPipePane: stopPipePaneSpy,
      });

      manager = new SessionManager(deps);
      manager.start();

      const reader = Array.from(fifoReaders.values())[0];

      manager.stop();

      expect(stopPipePaneSpy).toHaveBeenCalled();
      expect(reader?.killed).toBe(true);
    });

    it("falls back gracefully when FIFO creation fails", () => {
      const { deps } = createMockDeps({
        createFifo: () => false,
      });

      manager = new SessionManager(deps, { pollIntervalMs: 5000 });
      manager.start();

      // Session should still be created
      expect(manager.getSessions()).toHaveLength(1);
      expect(manager.getSessions()[0]?.status).toBe("busy");
    });

    it("falls back gracefully when startPipePane fails", () => {
      const stopPipePaneSpy = mock(() => true);

      const { deps } = createMockDeps({
        startPipePane: () => false,
        stopPipePane: stopPipePaneSpy,
      });

      manager = new SessionManager(deps, { pollIntervalMs: 5000 });
      manager.start();

      // Session should still be created
      expect(manager.getSessions()).toHaveLength(1);
      // Cleanup should have been attempted
      expect(stopPipePaneSpy).toHaveBeenCalled();
    });

    it("recreates pipe-pane when PID changes", async () => {
      let currentPid = 2000;
      const createFifoSpy = mock(() => true);

      const { deps, fifoReaders } = createMockDeps({
        getMonitoredProcesses: () => [{ pid: currentPid, ppid: 1000, binaryName: "claude" }],
        createFifo: createFifoSpy,
      });

      manager = new SessionManager(deps, { pollIntervalMs: 50 });
      manager.start();

      expect(createFifoSpy).toHaveBeenCalledTimes(1);
      const oldReader = Array.from(fifoReaders.values())[0];

      // PID changes
      currentPid = 3000;
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Old reader should be killed, new one created
      expect(oldReader?.killed).toBe(true);
      expect(createFifoSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("does not transition when pipe-pane data arrives during BUSY", async () => {
      const onChangeSpy = mock(() => {});

      const { deps, fifoReaders } = createMockDeps();

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 5000, // Keep BUSY for a long time
      });
      manager.onChange(onChangeSpy);
      manager.start();

      // Session starts BUSY
      expect(manager.getSessions()[0]?.status).toBe("busy");
      const countAfterCreate = onChangeSpy.mock.calls.length;

      // Pipe-pane data while BUSY — should not trigger onChange
      const reader = Array.from(fifoReaders.values())[0];
      reader?.simulateData("output");

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(manager.getSessions()[0]?.status).toBe("busy");
      expect(onChangeSpy.mock.calls.length).toBe(countAfterCreate);
    });
  });

  describe("content hash guard", () => {
    it("skips Gemini when pane content unchanged since last summary", async () => {
      let callCount = 0;
      let contentCounter = 0;
      let paneContent = "static content";
      const generateSpy2 = mock(async () => `Summary v${++callCount}`);
      const { deps } = createMockDeps({
        generateSummary: generateSpy2,
        capturePaneContent: () => paneContent,
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 30,
        summaryDelayMs: 100,
        paneCheckIntervalMs: 30,
      });
      manager.start();

      // First cycle: generates summary (hash=null → new hash)
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(generateSpy2).toHaveBeenCalledTimes(1);

      // Go BUSY via continuous content changes
      const interval = setInterval(() => {
        paneContent = `busy ${++contentCounter}`;
      }, 20);
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(manager.getSessions()[0]?.status).toBe("busy");
      clearInterval(interval);

      // Revert content — should settle back to WAITING
      paneContent = "static content";
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(manager.getSessions()[0]?.status).toBe("waiting");

      // Should NOT have called Gemini again — content hash unchanged
      expect(generateSpy2).toHaveBeenCalledTimes(1);
      // Summary should still be available (cached)
      expect(manager.getSessions()[0]?.summary).toBe("Summary v1");
    });

    it("calls Gemini when pane content has changed", async () => {
      let paneContent = "initial pane content";
      const generateSpy = mock(async () => `Summary for: ${paneContent}`);

      const { deps } = createMockDeps({
        generateSummary: generateSpy,
        capturePaneContent: () => paneContent,
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 30,
        summaryDelayMs: 100,
        paneCheckIntervalMs: 30,
      });
      manager.start();

      // First summary generation
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(generateSpy).toHaveBeenCalledTimes(1);

      // Change pane content → BUSY via content change, then settle to new content
      paneContent = "updated pane content";

      // Wait for idle → WAITING + summary delay
      await new Promise((resolve) => setTimeout(resolve, 250));

      // Should have called Gemini again because content changed
      expect(generateSpy).toHaveBeenCalledTimes(2);
    });

    it("retries after Gemini returns null", async () => {
      let callCount = 0;
      const generateSpy = mock(async () => {
        callCount++;
        if (callCount <= 2) return null; // Fail first two attempts
        return "Recovered summary";
      });

      const { deps } = createMockDeps({
        generateSummary: generateSpy,
        capturePaneContent: () => "static pane content",
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 30,
        summaryDelayMs: 100, // Short delay for faster test
        paneCheckIntervalMs: 30,
      });
      manager.start();

      // First attempt: summary delay triggers, returns null
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(generateSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(manager.getSessions()[0]?.summary).toBeNull();

      // Eventually recovers — wait enough for multiple retries
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(generateSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(manager.getSessions()[0]?.summary).toBe("Recovered summary");
    });

    it("does not update content hash when Gemini returns null", async () => {
      let geminiResult: string | null = null;
      let paneContent = "same pane content";

      const { deps } = createMockDeps({
        generateSummary: async () => geminiResult,
        capturePaneContent: () => paneContent,
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 30,
        summaryDelayMs: 150,
        paneCheckIntervalMs: 30,
      });
      manager.start();

      // First attempt returns null (idle 30ms + delay 150ms = ~180ms)
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Go BUSY via content change, then back to WAITING
      paneContent = "changed content";
      await new Promise((resolve) => setTimeout(resolve, 80));

      // Now Gemini will succeed
      geminiResult = "Success summary";
      paneContent = "same pane content";
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Gemini should be called again because hash was NOT cached on null return
      expect(manager.getSessions()[0]?.summary).toBe("Success summary");
    });

    it("stores summary even when session goes BUSY during Gemini call", async () => {
      const pending: { resolve: ((value: string | null) => void) | null } = { resolve: null };
      const generateSpy = mock(
        () =>
          new Promise<string | null>((resolve) => {
            pending.resolve = resolve;
          }),
      );

      const { deps } = createMockDeps({
        generateSummary: generateSpy,
        capturePaneContent: () => "pane content about new topic",
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 30,
        summaryDelayMs: 100,
        paneCheckIntervalMs: 30,
      });
      manager.start();

      // Wait for WAITING + summary delay → Gemini call starts
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(generateSpy).toHaveBeenCalledTimes(1);

      // Session goes BUSY while Gemini is still processing via content change
      let busyCount = 0;
      deps.capturePaneContent = () => `user typing ${++busyCount}`;
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(manager.getSessions()[0]?.status).toBe("busy");

      // Gemini returns — session is now BUSY
      pending.resolve?.("Summary about new topic");
      await new Promise((resolve) => setTimeout(resolve, 10));

      // API returns null during BUSY (expected filtering)
      expect(manager.getSessions()[0]?.summary).toBeNull();

      // Stop changing content — session goes back to WAITING
      deps.capturePaneContent = () => "pane content about new topic";
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(manager.getSessions()[0]?.status).toBe("waiting");
      expect(manager.getSessions()[0]?.summary).toBe("Summary about new topic");
    });

    it("cancels retry timer when session goes BUSY", async () => {
      const generateSpy = mock(async () => null); // Always fail
      let paneContent = "static content";

      const { deps } = createMockDeps({
        generateSummary: generateSpy,
        capturePaneContent: () => paneContent,
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 30,
        summaryDelayMs: 100,
        paneCheckIntervalMs: 30,
      });
      manager.start();

      // First attempt fails, retry scheduled (idle 30ms + delay 100ms = ~130ms)
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(generateSpy).toHaveBeenCalledTimes(1);

      // Go BUSY via content change (cancels retry timer via checkPaneContent → cancelSummaryTimer)
      paneContent = "new content";
      await new Promise((resolve) => setTimeout(resolve, 80));

      // Revert content and wait past original retry time
      paneContent = "static content";
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Retry timer was cancelled — summary generation restarts from scratch
      expect(manager.getSessions()[0]?.status).toBe("waiting");
    });
  });

  describe("auth error retry suppression", () => {
    it("uses slow retry (60s) when isAuthError returns true", async () => {
      const generateSpy = mock(async () => null); // Always fail

      const { deps } = createMockDeps({
        generateSummary: generateSpy,
        capturePaneContent: () => "static content",
        isAuthError: () => true,
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 30,
        summaryDelayMs: 100,
        paneCheckIntervalMs: 30,
      });
      manager.start();

      // First attempt: idle 30ms + delay 100ms = ~130ms
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(generateSpy).toHaveBeenCalledTimes(1);

      // Wait 500ms more — with auth error, retry is 60s, so no second call
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(generateSpy).toHaveBeenCalledTimes(1);
    });

    it("uses normal retry when isAuthError returns false", async () => {
      const generateSpy = mock(async () => null); // Always fail

      const { deps } = createMockDeps({
        generateSummary: generateSpy,
        capturePaneContent: () => "static content",
        isAuthError: () => false,
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 30,
        summaryDelayMs: 100,
        paneCheckIntervalMs: 30,
      });
      manager.start();

      // First attempt
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(generateSpy).toHaveBeenCalledTimes(1);

      // Normal retry at summaryDelayMs (100ms) — should call again
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(generateSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("fires onChange when auth error suppresses retry", async () => {
      const onChangeSpy = mock(() => {});

      const { deps } = createMockDeps({
        generateSummary: async () => null,
        capturePaneContent: () => "static content",
        isAuthError: () => true,
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 30,
        summaryDelayMs: 100,
        paneCheckIntervalMs: 30,
      });
      manager.onChange(onChangeSpy);
      manager.start();

      // Wait for first summary attempt + auth error handling
      await new Promise((resolve) => setTimeout(resolve, 250));

      // onChange should have been called (for session discovery + auth error notification)
      expect(onChangeSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("API summary filtering", () => {
    it("getSessions returns null summary for BUSY sessions", () => {
      const { deps } = createMockDeps();
      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 5000, // Stay BUSY
      });
      manager.start();

      const sessions = manager.getSessions();
      expect(sessions[0]?.status).toBe("busy");
      expect(sessions[0]?.summary).toBeNull();
    });

    it("getSession returns null summary for BUSY sessions", () => {
      const { deps } = createMockDeps();
      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 5000, // Stay BUSY
      });
      manager.start();

      const session = manager.getSession("%0");
      expect(session?.status).toBe("busy");
      expect(session?.summary).toBeNull();
    });

    it("getSessions returns summary for WAITING sessions", async () => {
      const { deps } = createMockDeps({
        generateSummary: async () => "Test summary",
        capturePaneContent: () => "static content",
      });
      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 30,
        summaryDelayMs: 100,
        paneCheckIntervalMs: 30,
      });
      manager.start();

      await new Promise((resolve) => setTimeout(resolve, 250));

      const sessions = manager.getSessions();
      expect(sessions[0]?.status).toBe("waiting");
      expect(sessions[0]?.summary).toBe("Test summary");
    });
  });

  describe("real-time pane destruction detection", () => {
    it("keeps session alive when reader exits unexpectedly", async () => {
      const { deps, fifoReaders } = createMockDeps();

      manager = new SessionManager(deps, {
        pollIntervalMs: 60_000,
        paneCheckIntervalMs: 60_000,
      });
      manager.start();

      expect(manager.getSessions()).toHaveLength(1);

      // Simulate FIFO EOF — reader exits while tmux pane is still alive
      const reader = Array.from(fifoReaders.values())[0];
      reader?.simulateExit();

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Session stays — poll() owns pane lifetime, not the FIFO reader.
      expect(manager.getSessions()).toHaveLength(1);
    });

    it("does not fire onChange when reader exits unexpectedly", async () => {
      const onChangeSpy = mock(() => {});
      const { deps, fifoReaders } = createMockDeps();

      manager = new SessionManager(deps, {
        pollIntervalMs: 60_000,
        paneCheckIntervalMs: 60_000,
      });
      manager.onChange(onChangeSpy);
      manager.start();

      const countAfterStart = onChangeSpy.mock.calls.length;

      const reader = Array.from(fifoReaders.values())[0];
      reader?.simulateExit();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onChangeSpy.mock.calls.length).toBe(countAfterStart);
    });

    it("re-arms pipe-pane on the next checkPaneContent tick after reader exit", async () => {
      const { deps, fifoReaders } = createMockDeps();

      manager = new SessionManager(deps, {
        pollIntervalMs: 60_000,
        paneCheckIntervalMs: 50,
      });
      manager.start();

      expect(fifoReaders.size).toBe(1);

      const firstReader = Array.from(fifoReaders.values())[0];
      firstReader?.simulateExit();

      await new Promise((resolve) => setTimeout(resolve, 120));

      // A new reader should be spawned by the re-arm path; total ever-created
      // count grew, and the session is still alive.
      expect(fifoReaders.size).toBeGreaterThanOrEqual(2);
      expect(manager.getSessions()).toHaveLength(1);
    });

    it("backs off pipe-pane setup when startPipePane keeps failing", async () => {
      const startCalls: string[] = [];
      const { deps } = createMockDeps({
        startPipePane: (paneId) => {
          startCalls.push(paneId);
          return false;
        },
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 60_000,
        paneCheckIntervalMs: 50,
      });
      manager.start();

      const initialCount = startCalls.length;
      expect(initialCount).toBeGreaterThanOrEqual(1);

      // Wait through several paneCheckIntervalMs ticks. With 1 s minimum
      // backoff after the first failure, no additional calls should happen
      // within ~500 ms.
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(startCalls.length).toBe(initialCount);
    });

    it("does not double-remove when teardownPipePane kills the reader", async () => {
      const { deps, fifoReaders } = createMockDeps();

      manager = new SessionManager(deps, {
        pollIntervalMs: 60_000,
        paneCheckIntervalMs: 60_000,
      });
      manager.start();

      expect(manager.getSessions()).toHaveLength(1);

      // Explicitly stop the manager (triggers teardownPipePane which
      // deletes from pipePanes before killing reader)
      manager.stop();

      // Simulate the exit event that fires asynchronously after kill
      const reader = Array.from(fifoReaders.values())[0];
      reader?.simulateExit();

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Session should still exist — stop() only tears down pipes,
      // and the exit handler should NOT remove because pipePanes was cleared
      expect(manager.getSessions()).toHaveLength(1);
    });
  });

  describe("poll error resilience", () => {
    it("removes stale sessions even when a new pane's creation throws", async () => {
      let currentPanes: TmuxPane[] = [
        {
          pane_id: "%0",
          pane_pid: 1000,
          session_name: "main",
          window_index: 0,
          pane_index: 0,
          window_name: "main",
        },
      ];
      let currentProcesses: MonitoredProcess[] = [{ pid: 2000, ppid: 1000, binaryName: "claude" }];
      let currentProcessTable: ProcessInfo[] = [
        { pid: 1000, ppid: 1, command: "-bash" },
        { pid: 2000, ppid: 1000, command: "claude" },
      ];

      const { deps } = createMockDeps({
        getAllTmuxPanes: () => currentPanes,
        getMonitoredProcesses: () => currentProcesses,
        getProcessTable: () => currentProcessTable,
        matchProcessesToPanes: (processes, paneList, _processTable) => {
          const paneByPid = new Map<number, TmuxPane>();
          for (const pane of paneList) paneByPid.set(pane.pane_pid, pane);
          const result = new Map<string, { process: MonitoredProcess; pane: TmuxPane }>();
          for (const proc of processes) {
            const pane = paneByPid.get(proc.ppid);
            if (pane) result.set(pane.pane_id, { process: proc, pane });
          }
          return result;
        },
        getProcessCwd: (pid: number) => {
          if (pid === 3000) throw new Error("Simulated getProcessCwd failure");
          return "/home/user/project";
        },
      });

      manager = new SessionManager(deps, { pollIntervalMs: 50 });
      manager.start();

      // First poll: pane %0 created successfully
      expect(manager.getSessions()).toHaveLength(1);
      expect(manager.getSessions()[0].pane_id).toBe("%0");

      // Second poll: pane %0 gone, new pane %1 appears but createSession throws
      currentPanes = [
        {
          pane_id: "%1",
          pane_pid: 1001,
          session_name: "main",
          window_index: 0,
          pane_index: 1,
          window_name: "main",
        },
      ];
      currentProcesses = [{ pid: 3000, ppid: 1001, binaryName: "claude" }];
      currentProcessTable = [
        { pid: 1001, ppid: 1, command: "-bash" },
        { pid: 3000, ppid: 1001, command: "claude" },
      ];

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Stale session %0 should be removed despite the throw for %1
      const sessions = manager.getSessions();
      expect(sessions.some((s) => s.pane_id === "%0")).toBe(false);
    });
  });

  describe("pipe-pane death recovery via capture-pane", () => {
    it("fires paneActivityCallback on capture-pane content change", async () => {
      let paneContent = "initial";
      const activitySpy = mock(() => {});
      const { deps } = createMockDeps({
        capturePaneContent: () => paneContent,
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 50,
        paneCheckIntervalMs: 30,
        summaryDelayMs: 5000,
      });
      manager.onPaneActivity(activitySpy);
      manager.start();

      // Wait for WAITING
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Content change triggers activity callback
      paneContent = "new content";
      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(activitySpy).toHaveBeenCalledWith("%0");
    });
  });

  describe("pipe-pane SIGKILL escalation", () => {
    it("sends SIGKILL after SIGTERM when tearing down pipe-pane", async () => {
      const { deps, fifoReaders } = createMockDeps();

      manager = new SessionManager(deps, { pollIntervalMs: 5000 });
      manager.start();

      const reader = Array.from(fifoReaders.values())[0] as MockFifoReader;

      manager.stop();

      // SIGTERM sent immediately
      expect(reader.killSignals).toContain("SIGTERM");

      // Wait for SIGKILL escalation (500ms + buffer)
      await new Promise((resolve) => setTimeout(resolve, 700));

      expect(reader.killSignals).toContain("SIGKILL");
    });
  });
});
