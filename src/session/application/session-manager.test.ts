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
    getGitBranch: () => "main",
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
      expect(sessions[0].git_branch).toBe("main");
      expect(sessions[0].status).toBe("busy");
      expect(sessions[0].tmux_target).toBe("main:0.0");
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

    it("stays BUSY when pipe-pane keeps receiving data", async () => {
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

      // Should still be BUSY because pipe-pane keeps receiving data
      expect(manager.getSessions()[0]?.status).toBe("busy");
    });

    it("transitions back to BUSY when pipe-pane data arrives after WAITING", async () => {
      const { deps, fifoReaders } = createMockDeps();
      const onChangeSpy = mock(() => {});

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 100,
      });
      manager.onChange(onChangeSpy);
      manager.start();

      // Wait for idle
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(manager.getSessions()[0]?.status).toBe("waiting");

      // Simulate pipe-pane data (Claude starts outputting)
      const reader = Array.from(fifoReaders.values())[0];
      reader?.simulateData("output");

      // Should be back to BUSY
      expect(manager.getSessions()[0]?.status).toBe("busy");
    });

    it("resets idle timer when pipe-pane data arrives during BUSY", async () => {
      const { deps, fifoReaders } = createMockDeps();
      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 150,
      });
      manager.start();

      // Initially BUSY
      expect(manager.getSessions()[0]?.status).toBe("busy");

      // At 100ms, send pipe data (before 150ms idle threshold)
      await new Promise((resolve) => setTimeout(resolve, 100));
      const reader = Array.from(fifoReaders.values())[0];
      reader?.simulateData("output");

      // At 200ms (100ms after last data, still within 150ms threshold)
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(manager.getSessions()[0]?.status).toBe("busy");

      // At 300ms (200ms after last data, past 150ms threshold)
      await new Promise((resolve) => setTimeout(resolve, 100));
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
        getGitBranch: () => (currentPid === 2000 ? "feature-a" : "feature-b"),
        getProcessCwd: () =>
          currentPid === 2000 ? "/home/user/project-a" : "/home/user/project-b",
      });

      manager = new SessionManager(deps, { pollIntervalMs: 50 });
      manager.start();

      // Initial session
      expect(manager.getSessions()).toHaveLength(1);
      expect(manager.getSessions()[0].git_branch).toBe("feature-a");

      // Claude restarts with a different PID in the same pane
      currentPid = 3000;
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Session should be recreated with fresh metadata
      const sessions = manager.getSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].git_branch).toBe("feature-b");
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
        getGitBranch: () => (currentPid === 2000 ? "old-branch" : "new-branch"),
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 50,
        idleThresholdMs: 30,
      });
      manager.start();

      // Wait for WAITING status
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(manager.getSessions()[0]?.status).toBe("waiting");
      expect(manager.getSessions()[0]?.git_branch).toBe("old-branch");

      // PID change: new Claude starts
      currentPid = 3000;
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Session should be recreated with fresh metadata
      expect(manager.getSessions()[0]?.git_branch).toBe("new-branch");
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

      const { deps, fifoReaders } = createMockDeps({
        generateSummary: generateSpy,
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 50,
        summaryDelayMs: 200,
      });
      manager.start();

      // Wait for WAITING (50ms idle threshold)
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(manager.getSessions()[0]?.status).toBe("waiting");

      // Go BUSY before summary delay fires via pipe-pane data
      const reader = Array.from(fifoReaders.values())[0];
      reader?.simulateData("output");
      expect(manager.getSessions()[0]?.status).toBe("busy");

      // Wait past the original summary delay
      await new Promise((resolve) => setTimeout(resolve, 250));

      // Gemini should NOT have been called — the timer was cancelled
      expect(generateSpy).not.toHaveBeenCalled();
    });

    it("does not call Gemini during brief BUSY↔WAITING cycling", async () => {
      const generateSpy = mock(async () => "test");

      const { deps, fifoReaders } = createMockDeps({
        generateSummary: generateSpy,
        capturePaneContent: () => "static pane content",
      });

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 30,
        summaryDelayMs: 200,
      });
      manager.start();

      // Rapid BUSY↔WAITING cycling: go idle, then active, repeat
      const reader = Array.from(fifoReaders.values())[0];
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50)); // idle → WAITING
        reader?.simulateData("output"); // → BUSY (cancels summary timer)
      }

      // Wait past summary delay
      await new Promise((resolve) => setTimeout(resolve, 300));

      // The final cycle left the session BUSY (last action was simulateData),
      // then idle again. Only the LAST sustained WAITING should trigger Gemini.
      // But since we ended with simulateData (BUSY) and then waited,
      // it should have triggered exactly once for the final sustained idle.
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

    it("transitions from WAITING to BUSY when pipe-pane receives data", async () => {
      const { deps, fifoReaders } = createMockDeps();

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 50,
        paneCheckIntervalMs: 5000, // Disable pane polling (long interval)
      });
      manager.start();

      // Wait for WAITING
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(manager.getSessions()[0]?.status).toBe("waiting");

      // Simulate pipe-pane data
      const reader = Array.from(fifoReaders.values())[0];
      reader?.simulateData("some output");

      // Should transition to BUSY immediately
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(manager.getSessions()[0]?.status).toBe("busy");
    });

    it("returns null summary via API when pipe-pane triggers BUSY (cached internally)", async () => {
      const generateSpy = mock(async () => "Some summary");

      const { deps, fifoReaders } = createMockDeps({
        generateSummary: generateSpy,
        capturePaneContent: () => "static content",
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

      // Pipe-pane data → BUSY, API returns null summary
      const reader = Array.from(fifoReaders.values())[0];
      reader?.simulateData("new output");

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(manager.getSessions()[0]?.status).toBe("busy");
      // API should return null summary for BUSY sessions
      expect(manager.getSessions()[0]?.summary).toBeNull();
      expect(manager.getSession("%0")?.summary).toBeNull();
    });

    it("fires onChange when pipe-pane triggers WAITING → BUSY", async () => {
      const onChangeSpy = mock(() => {});

      const { deps, fifoReaders } = createMockDeps();

      manager = new SessionManager(deps, {
        pollIntervalMs: 5000,
        idleThresholdMs: 50,
        paneCheckIntervalMs: 5000,
      });
      manager.onChange(onChangeSpy);
      manager.start();

      // Wait for WAITING
      await new Promise((resolve) => setTimeout(resolve, 100));
      const countAfterWaiting = onChangeSpy.mock.calls.length;

      // Pipe-pane data
      const reader = Array.from(fifoReaders.values())[0];
      reader?.simulateData("output");

      await new Promise((resolve) => setTimeout(resolve, 10));
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
      const generateSpy2 = mock(async () => `Summary v${++callCount}`);
      const { deps, fifoReaders } = createMockDeps({
        generateSummary: generateSpy2,
        capturePaneContent: () => "static content", // content never changes
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

      // Go BUSY via pipe-pane data, then idle → WAITING again
      const reader = Array.from(fifoReaders.values())[0];
      reader?.simulateData("output");
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(manager.getSessions()[0]?.status).toBe("busy");

      // Wait for idle → WAITING again + summary delay
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

      const { deps, fifoReaders } = createMockDeps({
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

      // Go BUSY, change pane content, then back to WAITING
      const reader = Array.from(fifoReaders.values())[0];
      reader?.simulateData("output");
      await new Promise((resolve) => setTimeout(resolve, 10));

      paneContent = "updated pane content"; // Content changed

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
      const generateSpy = mock(async () => geminiResult);

      const { deps, fifoReaders } = createMockDeps({
        generateSummary: generateSpy,
        capturePaneContent: () => "same pane content",
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
      expect(generateSpy).toHaveBeenCalledTimes(1);

      // Go BUSY then WAITING again
      const reader = Array.from(fifoReaders.values())[0];
      reader?.simulateData("output");
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Now Gemini will succeed
      geminiResult = "Success summary";
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Gemini should be called again because hash was NOT cached on null return
      expect(generateSpy).toHaveBeenCalledTimes(2);
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

      const { deps, fifoReaders } = createMockDeps({
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

      // Session goes BUSY while Gemini is still processing
      const reader = Array.from(fifoReaders.values())[0];
      reader?.simulateData("user typing");
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(manager.getSessions()[0]?.status).toBe("busy");

      // Gemini returns — session is now BUSY
      pending.resolve?.("Summary about new topic");
      await new Promise((resolve) => setTimeout(resolve, 10));

      // API returns null during BUSY (expected filtering)
      expect(manager.getSessions()[0]?.summary).toBeNull();

      // Session goes back to WAITING — summary should reflect the new topic
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(manager.getSessions()[0]?.status).toBe("waiting");
      expect(manager.getSessions()[0]?.summary).toBe("Summary about new topic");
    });

    it("cancels retry timer when session goes BUSY", async () => {
      const generateSpy = mock(async () => null); // Always fail

      const { deps, fifoReaders } = createMockDeps({
        generateSummary: generateSpy,
        capturePaneContent: () => "static content",
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

      // Go BUSY (cancels retry timer via onPipePaneActivity → cancelSummaryTimer)
      const reader = Array.from(fifoReaders.values())[0];
      reader?.simulateData("output");
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Wait past original retry time
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Retry timer was cancelled — no extra Gemini call during BUSY
      expect(manager.getSessions()[0]?.status).toBe("waiting");
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
    it("removes session immediately when pipe-pane reader exits unexpectedly", async () => {
      const { deps, fifoReaders } = createMockDeps();

      manager = new SessionManager(deps, {
        pollIntervalMs: 60_000, // Long interval — rely on exit handler
        paneCheckIntervalMs: 60_000,
      });
      manager.start();

      expect(manager.getSessions()).toHaveLength(1);

      // Simulate pane destruction — reader exits
      const reader = Array.from(fifoReaders.values())[0];
      reader?.simulateExit();

      // Allow async exit event to propagate
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(manager.getSessions()).toHaveLength(0);
    });

    it("fires onChange when reader exits unexpectedly", async () => {
      const onChangeSpy = mock(() => {});
      const { deps, fifoReaders } = createMockDeps();

      manager = new SessionManager(deps, {
        pollIntervalMs: 60_000,
        paneCheckIntervalMs: 60_000,
      });
      manager.onChange(onChangeSpy);
      manager.start();

      const countAfterStart = onChangeSpy.mock.calls.length;

      // Simulate pane destruction
      const reader = Array.from(fifoReaders.values())[0];
      reader?.simulateExit();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onChangeSpy.mock.calls.length).toBeGreaterThan(countAfterStart);
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
