import { describe, expect, it } from "bun:test";
import type { ClaudeProcess, ProcessInfo, TmuxPane } from "../domain/types";
import {
  buildTmuxTarget,
  getClaudeProcesses,
  isClaudeBinary,
  matchProcessesToPanes,
} from "./process-matching";

describe("isClaudeBinary", () => {
  it("matches bare claude command", () => {
    expect(isClaudeBinary("claude")).toBe(true);
  });

  it("matches claude with arguments", () => {
    expect(isClaudeBinary("claude --resume")).toBe(true);
    expect(isClaudeBinary("claude --agent-id worker@team --plan-mode")).toBe(true);
  });

  it("matches claude with full path", () => {
    expect(isClaudeBinary("/usr/local/bin/claude")).toBe(true);
    expect(isClaudeBinary("/opt/homebrew/bin/claude --resume")).toBe(true);
  });

  it("rejects Claude Desktop app (capital C)", () => {
    expect(isClaudeBinary("/Applications/Claude.app/Contents/MacOS/Claude")).toBe(false);
  });

  it("rejects processes with claude in path arguments", () => {
    expect(isClaudeBinary("nvim /Users/test/.claude/CLAUDE.md")).toBe(false);
    expect(isClaudeBinary("nvim --embed /Users/test/.claude/CLAUDE.md")).toBe(false);
  });

  it("rejects Claude Helper processes", () => {
    expect(
      isClaudeBinary(
        "/Applications/Claude.app/Contents/Frameworks/Claude Helper (GPU).app/Contents/MacOS/Claude Helper (GPU) --type=gpu-process",
      ),
    ).toBe(false);
  });

  it("rejects bun/node processes running claude-related scripts", () => {
    expect(isClaudeBinary("bun run /path/.claude/plugins/server.ts")).toBe(false);
    expect(isClaudeBinary("node /path/claude-code/index.js")).toBe(false);
  });

  it("rejects grep claude", () => {
    expect(isClaudeBinary("grep claude")).toBe(false);
  });
});

describe("getClaudeProcesses", () => {
  it("filters only claude CLI binary from process table", () => {
    const processTable: ProcessInfo[] = [
      { pid: 100, ppid: 1234, command: "claude" },
      { pid: 200, ppid: 5678, command: "claude --resume" },
      { pid: 300, ppid: 9012, command: "vim" },
      { pid: 400, ppid: 3456, command: "node server.js" },
    ];

    const processes = getClaudeProcesses(processTable);
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

    const processes = getClaudeProcesses(processTable);
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

    const processes = getClaudeProcesses(processTable);
    expect(processes).toHaveLength(1);
    expect(processes[0].pid).toBe(100);
  });

  it("returns empty array for empty table", () => {
    expect(getClaudeProcesses([])).toEqual([]);
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
  it("matches claude process whose direct parent is pane_pid", () => {
    const processes: ClaudeProcess[] = [{ pid: 100, ppid: 1234 }];
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

  it("matches claude through intermediate processes (ancestor walk)", () => {
    // shell (pane_pid=1000) → bun (pid=1500) → claude (pid=2000)
    const processes: ClaudeProcess[] = [{ pid: 2000, ppid: 1500 }];
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

  it("matches multiple claude sessions to different panes", () => {
    const processes: ClaudeProcess[] = [
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
    const processes: ClaudeProcess[] = [{ pid: 100, ppid: 9999 }];
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
    const processes: ClaudeProcess[] = [{ pid: 100, ppid: 1234 }];
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
