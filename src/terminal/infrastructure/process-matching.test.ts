import { describe, expect, it } from "bun:test";
import type { MonitoredProcess, ProcessInfo, TmuxPane } from "../domain/types";
import {
  buildTmuxTarget,
  getMonitoredProcesses,
  isMonitoredBinary,
  matchProcessesToPanes,
} from "./process-matching";

describe("isMonitoredBinary", () => {
  it("matches bare claude command", () => {
    expect(isMonitoredBinary("claude")).toBe(true);
  });

  it("matches claude with arguments", () => {
    expect(isMonitoredBinary("claude --resume")).toBe(true);
    expect(isMonitoredBinary("claude --agent-id worker@team --plan-mode")).toBe(true);
  });

  it("matches claude with full path", () => {
    expect(isMonitoredBinary("/usr/local/bin/claude")).toBe(true);
    expect(isMonitoredBinary("/opt/homebrew/bin/claude --resume")).toBe(true);
  });

  it("rejects Claude Desktop app (capital C)", () => {
    expect(isMonitoredBinary("/Applications/Claude.app/Contents/MacOS/Claude")).toBe(false);
  });

  it("rejects processes with claude in path arguments", () => {
    expect(isMonitoredBinary("nvim /Users/test/.claude/CLAUDE.md")).toBe(false);
    expect(isMonitoredBinary("nvim --embed /Users/test/.claude/CLAUDE.md")).toBe(false);
  });

  it("rejects Claude Helper processes", () => {
    expect(
      isMonitoredBinary(
        "/Applications/Claude.app/Contents/Frameworks/Claude Helper (GPU).app/Contents/MacOS/Claude Helper (GPU) --type=gpu-process",
      ),
    ).toBe(false);
  });

  it("rejects bun/node processes running claude-related scripts", () => {
    expect(isMonitoredBinary("bun run /path/.claude/plugins/server.ts")).toBe(false);
    expect(isMonitoredBinary("node /path/claude-code/index.js")).toBe(false);
  });

  it("rejects grep claude", () => {
    expect(isMonitoredBinary("grep claude")).toBe(false);
  });

  it("matches bare codex command", () => {
    expect(isMonitoredBinary("codex")).toBe(true);
  });

  it("matches codex with arguments", () => {
    expect(isMonitoredBinary("codex --full-auto")).toBe(true);
  });

  it("matches codex with full path", () => {
    expect(isMonitoredBinary("/opt/homebrew/bin/codex")).toBe(true);
    expect(
      isMonitoredBinary(
        "/opt/homebrew/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex/codex",
      ),
    ).toBe(true);
  });

  it("rejects node running codex launcher script", () => {
    expect(isMonitoredBinary("node /opt/homebrew/bin/codex")).toBe(false);
  });
});

describe("getMonitoredProcesses", () => {
  it("filters only monitored CLI binaries from process table", () => {
    const processTable: ProcessInfo[] = [
      { pid: 100, ppid: 1234, command: "claude" },
      { pid: 200, ppid: 5678, command: "claude --resume" },
      { pid: 300, ppid: 9012, command: "vim" },
      { pid: 400, ppid: 3456, command: "node server.js" },
    ];

    const processes = getMonitoredProcesses(processTable);
    expect(processes).toHaveLength(2);
    expect(processes[0]).toEqual({ pid: 100, ppid: 1234 });
    expect(processes[1]).toEqual({ pid: 200, ppid: 5678 });
  });

  it("filters out nvim editing .claude files", () => {
    const processTable: ProcessInfo[] = [
      { pid: 100, ppid: 1234, command: "claude" },
      { pid: 200, ppid: 2117, command: "nvim /Users/test/.claude/CLAUDE.md" },
      { pid: 300, ppid: 200, command: "nvim --embed /Users/test/.claude/CLAUDE.md" },
    ];

    const processes = getMonitoredProcesses(processTable);
    expect(processes).toHaveLength(1);
    expect(processes[0].pid).toBe(100);
  });

  it("filters out Claude Desktop app and helpers", () => {
    const processTable: ProcessInfo[] = [
      { pid: 100, ppid: 1234, command: "claude" },
      { pid: 657, ppid: 1, command: "/Applications/Claude.app/Contents/MacOS/Claude" },
      {
        pid: 849,
        ppid: 657,
        command:
          "/Applications/Claude.app/Contents/Frameworks/Claude Helper (GPU).app/Contents/MacOS/Claude Helper (GPU) --type=gpu-process",
      },
    ];

    const processes = getMonitoredProcesses(processTable);
    expect(processes).toHaveLength(1);
    expect(processes[0].pid).toBe(100);
  });

  it("returns empty array for empty table", () => {
    expect(getMonitoredProcesses([])).toEqual([]);
  });

  it("detects mixed claude and codex processes", () => {
    const processTable: ProcessInfo[] = [
      { pid: 100, ppid: 1234, command: "claude" },
      { pid: 200, ppid: 5678, command: "codex --full-auto" },
      { pid: 300, ppid: 9012, command: "vim" },
      { pid: 400, ppid: 3456, command: "node /opt/homebrew/bin/codex" },
    ];

    const processes = getMonitoredProcesses(processTable);
    expect(processes).toHaveLength(2);
    expect(processes[0]).toEqual({ pid: 100, ppid: 1234 });
    expect(processes[1]).toEqual({ pid: 200, ppid: 5678 });
  });
});

describe("buildTmuxTarget", () => {
  it("formats session:window.pane", () => {
    const pane: TmuxPane = {
      pane_id: "%0",
      pane_pid: 1234,
      session_name: "main",
      window_index: 2,
      pane_index: 1,
    };
    expect(buildTmuxTarget(pane)).toBe("main:2.1");
  });
});

describe("matchProcessesToPanes", () => {
  it("matches monitored process whose direct parent is pane_pid", () => {
    const processes: MonitoredProcess[] = [{ pid: 100, ppid: 1234 }];
    const panes: TmuxPane[] = [
      {
        pane_id: "%0",
        pane_pid: 1234,
        session_name: "main",
        window_index: 0,
        pane_index: 0,
      },
    ];
    const processTable: ProcessInfo[] = [
      { pid: 1234, ppid: 1, command: "-bash" },
      { pid: 100, ppid: 1234, command: "claude" },
    ];

    const result = matchProcessesToPanes(processes, panes, processTable);
    expect(result.size).toBe(1);
    expect(result.has("%0")).toBe(true);
    expect(result.get("%0")?.process.pid).toBe(100);
    expect(result.get("%0")?.pane.pane_id).toBe("%0");
  });

  it("matches process through intermediate processes (ancestor walk)", () => {
    // shell (pane_pid=1000) → bun (pid=1500) → claude (pid=2000)
    const processes: MonitoredProcess[] = [{ pid: 2000, ppid: 1500 }];
    const panes: TmuxPane[] = [
      {
        pane_id: "%0",
        pane_pid: 1000,
        session_name: "main",
        window_index: 0,
        pane_index: 0,
      },
    ];
    const processTable: ProcessInfo[] = [
      { pid: 1000, ppid: 1, command: "-bash" },
      { pid: 1500, ppid: 1000, command: "bun run launcher.ts" },
      { pid: 2000, ppid: 1500, command: "claude --agent-id worker" },
    ];

    const result = matchProcessesToPanes(processes, panes, processTable);
    expect(result.size).toBe(1);
    expect(result.has("%0")).toBe(true);
    expect(result.get("%0")?.process.pid).toBe(2000);
  });

  it("matches multiple sessions to different panes", () => {
    const processes: MonitoredProcess[] = [
      { pid: 100, ppid: 1234 },
      { pid: 200, ppid: 5678 },
    ];
    const panes: TmuxPane[] = [
      {
        pane_id: "%0",
        pane_pid: 1234,
        session_name: "main",
        window_index: 0,
        pane_index: 0,
      },
      {
        pane_id: "%1",
        pane_pid: 5678,
        session_name: "work",
        window_index: 1,
        pane_index: 0,
      },
    ];
    const processTable: ProcessInfo[] = [
      { pid: 1234, ppid: 1, command: "-bash" },
      { pid: 5678, ppid: 1, command: "-bash" },
      { pid: 100, ppid: 1234, command: "claude" },
      { pid: 200, ppid: 5678, command: "claude" },
    ];

    const result = matchProcessesToPanes(processes, panes, processTable);
    expect(result.size).toBe(2);
    expect(result.has("%0")).toBe(true);
    expect(result.has("%1")).toBe(true);
  });

  it("returns empty map when no matches", () => {
    const processes: MonitoredProcess[] = [{ pid: 100, ppid: 9999 }];
    const panes: TmuxPane[] = [
      {
        pane_id: "%0",
        pane_pid: 1234,
        session_name: "main",
        window_index: 0,
        pane_index: 0,
      },
    ];
    const processTable: ProcessInfo[] = [
      { pid: 1234, ppid: 1, command: "-bash" },
      { pid: 9999, ppid: 1, command: "unrelated" },
      { pid: 100, ppid: 9999, command: "claude" },
    ];

    const result = matchProcessesToPanes(processes, panes, processTable);
    expect(result.size).toBe(0);
  });

  it("handles empty inputs", () => {
    expect(matchProcessesToPanes([], [], []).size).toBe(0);
  });

  it("works with empty process table (falls back to no match)", () => {
    const processes: MonitoredProcess[] = [{ pid: 100, ppid: 1234 }];
    const panes: TmuxPane[] = [
      {
        pane_id: "%0",
        pane_pid: 1234,
        session_name: "main",
        window_index: 0,
        pane_index: 0,
      },
    ];

    // With empty processTable, direct PPID match still works via paneByPid check
    const result = matchProcessesToPanes(processes, panes, []);
    expect(result.size).toBe(1);
    expect(result.has("%0")).toBe(true);
  });
});
