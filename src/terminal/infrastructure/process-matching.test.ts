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

  it("matches bare nori command", () => {
    expect(isMonitoredBinary("nori")).toBe(true);
  });

  it("matches nori with arguments and full path", () => {
    expect(isMonitoredBinary("nori -a crux-lead-mywork")).toBe(true);
    expect(
      isMonitoredBinary(
        "/home/user/.local/share/mise/installs/node/24.16.0/lib/node_modules/nori-ai-cli/vendor/x86_64-unknown-linux-musl/nori/nori --skip-welcome",
      ),
    ).toBe(true);
  });

  it("rejects node running nori launcher script", () => {
    expect(isMonitoredBinary("node /home/user/.local/bin/nori")).toBe(false);
  });

  it("matches Agent Teams worker launched from versioned bundle path", () => {
    expect(
      isMonitoredBinary(
        "/home/user/.local/share/claude/versions/2.1.183 --agent-id agent-foo@session-x --agent-name agent-foo --team-name session-x --agent-color blue --parent-session-id abc --agent-type general-purpose --permission-mode auto --model claude-opus-4-8",
      ),
    ).toBe(true);
  });

  it("rejects a path that merely contains claude/versions in arguments", () => {
    expect(isMonitoredBinary("ls /home/user/.local/share/claude/versions/")).toBe(false);
  });

  it("matches versioned-bundle path containing spaces (macOS Application Support)", () => {
    expect(
      isMonitoredBinary(
        "/Users/Foo Bar/Library/Application Support/claude/versions/2.1.183 --agent-id w@s --team-name s",
      ),
    ).toBe(true);
  });

  it("rejects editors opening a file under a claude/versions/ path", () => {
    expect(isMonitoredBinary("vim /home/user/claude/versions/2.1.183")).toBe(false);
    expect(isMonitoredBinary("vim /home/user/claude/versions/2.1.183 --readonly")).toBe(false);
    expect(
      isMonitoredBinary("nvim --embed /Users/test/.claude/plugins/claude/versions/2.1.183"),
    ).toBe(false);
  });

  it("rejects editors invoked by absolute path that open a versioned-bundle file", () => {
    // ps -eo command emits the resolved binary path, so argv[0] is typically
    // absolute. Ensure the argv[0]/argv[1] boundary check still rejects when
    // both argv[0] and the file argument are absolute paths.
    expect(isMonitoredBinary("/usr/bin/vim /home/user/claude/versions/2.1.183")).toBe(false);
    expect(isMonitoredBinary("/usr/bin/vim /home/user/claude/versions/2.1.183 --readonly")).toBe(
      false,
    );
    expect(isMonitoredBinary("/opt/homebrew/bin/nvim /Users/x/claude/versions/2.1.183")).toBe(
      false,
    );
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
    expect(processes[0]).toEqual({ pid: 100, ppid: 1234, binaryName: "claude" });
    expect(processes[1]).toEqual({ pid: 200, ppid: 5678, binaryName: "claude" });
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

  it("normalises versioned-bundle worker path to claude binaryName", () => {
    const processTable: ProcessInfo[] = [
      {
        pid: 24113,
        ppid: 1705,
        command:
          "/home/user/.local/share/claude/versions/2.1.183 --agent-id w@s --team-name s --agent-type general-purpose",
      },
    ];

    const processes = getMonitoredProcesses(processTable);
    expect(processes).toHaveLength(1);
    expect(processes[0]).toEqual({ pid: 24113, ppid: 1705, binaryName: "claude" });
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
    expect(processes[0]).toEqual({ pid: 100, ppid: 1234, binaryName: "claude" });
    expect(processes[1]).toEqual({ pid: 200, ppid: 5678, binaryName: "codex" });
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
      window_name: "win",
    };
    expect(buildTmuxTarget(pane)).toBe("main:2.1");
  });
});

describe("matchProcessesToPanes", () => {
  it("matches monitored process whose direct parent is pane_pid", () => {
    const processes: MonitoredProcess[] = [{ pid: 100, ppid: 1234, binaryName: "claude" }];
    const panes: TmuxPane[] = [
      {
        pane_id: "%0",
        pane_pid: 1234,
        session_name: "main",
        window_index: 0,
        pane_index: 0,
        window_name: "win",
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
    const processes: MonitoredProcess[] = [{ pid: 2000, ppid: 1500, binaryName: "claude" }];
    const panes: TmuxPane[] = [
      {
        pane_id: "%0",
        pane_pid: 1000,
        session_name: "main",
        window_index: 0,
        pane_index: 0,
        window_name: "win",
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
      { pid: 100, ppid: 1234, binaryName: "claude" },
      { pid: 200, ppid: 5678, binaryName: "claude" },
    ];
    const panes: TmuxPane[] = [
      {
        pane_id: "%0",
        pane_pid: 1234,
        session_name: "main",
        window_index: 0,
        pane_index: 0,
        window_name: "win",
      },
      {
        pane_id: "%1",
        pane_pid: 5678,
        session_name: "work",
        window_index: 1,
        pane_index: 0,
        window_name: "win",
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
    const processes: MonitoredProcess[] = [{ pid: 100, ppid: 9999, binaryName: "claude" }];
    const panes: TmuxPane[] = [
      {
        pane_id: "%0",
        pane_pid: 1234,
        session_name: "main",
        window_index: 0,
        pane_index: 0,
        window_name: "win",
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

  it("matches when the agent itself is pane_pid (cron-launched tmux)", () => {
    // `tmux new-session -d claude` makes claude the pane's initial process,
    // so pane_pid equals the agent's pid and the agent's ppid is the tmux
    // server, which is not a pane_pid.
    const processes: MonitoredProcess[] = [{ pid: 2000, ppid: 1500, binaryName: "claude" }];
    const panes: TmuxPane[] = [
      {
        pane_id: "%0",
        pane_pid: 2000,
        session_name: "panopticon",
        window_index: 0,
        pane_index: 0,
        window_name: "win",
      },
    ];
    const processTable: ProcessInfo[] = [
      { pid: 1500, ppid: 1, command: "tmux" },
      { pid: 2000, ppid: 1500, command: "claude" },
    ];

    const result = matchProcessesToPanes(processes, panes, processTable);
    expect(result.size).toBe(1);
    expect(result.get("%0")?.process.pid).toBe(2000);
  });

  it("works with empty process table (falls back to no match)", () => {
    const processes: MonitoredProcess[] = [{ pid: 100, ppid: 1234, binaryName: "claude" }];
    const panes: TmuxPane[] = [
      {
        pane_id: "%0",
        pane_pid: 1234,
        session_name: "main",
        window_index: 0,
        pane_index: 0,
        window_name: "win",
      },
    ];

    // With empty processTable, direct PPID match still works via paneByPid check
    const result = matchProcessesToPanes(processes, panes, []);
    expect(result.size).toBe(1);
    expect(result.has("%0")).toBe(true);
  });
});
