import { describe, expect, it } from "bun:test";
import {
  capturePaneContent,
  getAllTmuxPanes,
  getGitBranch,
  getProcessCwd,
  getProcessStartTime,
  getProcessTable,
  getProjectName,
  isTmuxAvailable,
  startPipePane,
  stopPipePane,
  switchClient,
} from "./tmux-commands";

describe("isTmuxAvailable", () => {
  it("returns true when tmux list-sessions succeeds", () => {
    const exec = () => "session1: 1 windows";
    expect(isTmuxAvailable(exec)).toBe(true);
  });

  it("returns false when tmux is not available", () => {
    const exec = () => {
      throw new Error("tmux not found");
    };
    expect(isTmuxAvailable(exec)).toBe(false);
  });
});

describe("getAllTmuxPanes", () => {
  it("parses tmux list-panes output correctly", () => {
    const exec = () => "%0 1234 main 0 0\n%1 5678 work 1 0\n%2 9012 work 1 1";
    const panes = getAllTmuxPanes(exec);

    expect(panes).toHaveLength(3);
    expect(panes[0]).toEqual({
      pane_id: "%0",
      pane_pid: 1234,
      session_name: "main",
      window_index: 0,
      pane_index: 0,
    });
    expect(panes[1]).toEqual({
      pane_id: "%1",
      pane_pid: 5678,
      session_name: "work",
      window_index: 1,
      pane_index: 0,
    });
  });

  it("returns empty array when tmux fails", () => {
    const exec = () => {
      throw new Error("tmux error");
    };
    expect(getAllTmuxPanes(exec)).toEqual([]);
  });

  it("skips malformed lines", () => {
    const exec = () => "%0 1234 main 0 0\nbadline\n%1 5678 work 1 0";
    const panes = getAllTmuxPanes(exec);
    expect(panes).toHaveLength(2);
  });

  it("handles empty output", () => {
    const exec = () => "";
    expect(getAllTmuxPanes(exec)).toEqual([]);
  });
});

describe("getProcessTable", () => {
  it("parses ps output into ProcessInfo array", () => {
    const exec = () =>
      [
        "  PID  PPID COMMAND",
        "  100  1234 claude",
        "  200  5678 nvim /Users/test/.claude/CLAUDE.md",
        "  300     1 /Applications/Claude.app/Contents/MacOS/Claude",
      ].join("\n");

    const table = getProcessTable(exec);
    expect(table).toHaveLength(3);
    expect(table[0]).toEqual({ pid: 100, ppid: 1234, command: "claude" });
    expect(table[1]).toEqual({
      pid: 200,
      ppid: 5678,
      command: "nvim /Users/test/.claude/CLAUDE.md",
    });
    expect(table[2]).toEqual({
      pid: 300,
      ppid: 1,
      command: "/Applications/Claude.app/Contents/MacOS/Claude",
    });
  });

  it("returns empty array on failure", () => {
    const exec = () => {
      throw new Error("ps failed");
    };
    expect(getProcessTable(exec)).toEqual([]);
  });
});

describe("getProcessCwd", () => {
  it("parses lsof output for cwd", () => {
    const exec = () => "p1234\nfcwd\nn/Users/test/project";
    expect(getProcessCwd(1234, exec)).toBe("/Users/test/project");
  });

  it("returns null on failure", () => {
    const exec = () => {
      throw new Error("lsof failed");
    };
    expect(getProcessCwd(1234, exec)).toBeNull();
  });

  it("returns null when no cwd line found", () => {
    const exec = () => "p1234\nfother\n";
    expect(getProcessCwd(1234, exec)).toBeNull();
  });
});

describe("getProcessStartTime", () => {
  it("parses ps lstart output and returns ISO string", () => {
    const exec = () => "Wed Feb 11 11:46:36 2026";
    const result = getProcessStartTime(1234, exec);
    expect(result).toBe(new Date("Wed Feb 11 11:46:36 2026").toISOString());
  });

  it("returns null on failure", () => {
    const exec = () => {
      throw new Error("ps failed");
    };
    expect(getProcessStartTime(1234, exec)).toBeNull();
  });

  it("returns null on empty output", () => {
    const exec = () => "";
    expect(getProcessStartTime(1234, exec)).toBeNull();
  });
});

describe("getProjectName", () => {
  it("extracts repo name from SSH remote URL", () => {
    const exec = () => "git@github.com:user/my-repo.git";
    expect(getProjectName("/some/path", exec)).toBe("my-repo");
  });

  it("extracts repo name from HTTPS remote URL", () => {
    const exec = () => "https://github.com/user/my-repo.git";
    expect(getProjectName("/some/path", exec)).toBe("my-repo");
  });

  it("falls back to basename of cwd on failure", () => {
    const exec = () => {
      throw new Error("not a git repo");
    };
    expect(getProjectName("/Users/test/my-project", exec)).toBe("my-project");
  });
});

describe("getGitBranch", () => {
  it("returns branch name", () => {
    const exec = () => "feat/my-feature";
    expect(getGitBranch("/some/path", exec)).toBe("feat/my-feature");
  });

  it("returns null on failure", () => {
    const exec = () => {
      throw new Error("not a git repo");
    };
    expect(getGitBranch("/some/path", exec)).toBeNull();
  });
});

describe("capturePaneContent", () => {
  it("returns captured pane output", () => {
    const exec = () => "line 1\nline 2\n❯ ";
    expect(capturePaneContent("%0", exec)).toBe("line 1\nline 2\n❯ ");
  });

  it("returns null on tmux error", () => {
    const exec = () => {
      throw new Error("tmux error");
    };
    expect(capturePaneContent("%0", exec)).toBeNull();
  });
});

describe("startPipePane", () => {
  it("calls tmux pipe-pane with output-only flag", () => {
    let executedCommand = "";
    const exec = (cmd: string) => {
      executedCommand = cmd;
      return "";
    };

    const result = startPipePane("%0", "/tmp/test.fifo", exec);
    expect(result).toBe(true);
    expect(executedCommand).toContain("tmux pipe-pane -o");
    expect(executedCommand).toContain("%0");
    expect(executedCommand).toContain("/tmp/test.fifo");
  });

  it("returns false on failure", () => {
    const exec = () => {
      throw new Error("pane not found");
    };

    expect(startPipePane("%99", "/tmp/test.fifo", exec)).toBe(false);
  });
});

describe("stopPipePane", () => {
  it("calls tmux pipe-pane with no command to cancel", () => {
    let executedCommand = "";
    const exec = (cmd: string) => {
      executedCommand = cmd;
      return "";
    };

    const result = stopPipePane("%0", exec);
    expect(result).toBe(true);
    expect(executedCommand).toContain("tmux pipe-pane");
    expect(executedCommand).toContain("%0");
    // Should NOT contain -o (no output flag when cancelling)
    expect(executedCommand).not.toContain("-o");
  });

  it("returns false on failure", () => {
    const exec = () => {
      throw new Error("pane not found");
    };

    expect(stopPipePane("%99", exec)).toBe(false);
  });
});

describe("switchClient", () => {
  it("calls tmux switch-client with escaped pane id", () => {
    let executedCommand = "";
    const exec = (cmd: string) => {
      executedCommand = cmd;
      return "";
    };

    const result = switchClient("%0", exec);
    expect(result).toBe(true);
    expect(executedCommand).toContain("tmux switch-client");
    expect(executedCommand).toContain("%0");
  });

  it("returns false on failure", () => {
    const exec = () => {
      throw new Error("pane not found");
    };

    expect(switchClient("%99", exec)).toBe(false);
  });
});
