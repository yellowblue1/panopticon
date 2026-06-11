import { describe, expect, it } from "bun:test";
import {
  capturePaneContent,
  capturePaneContentEscaped,
  capturePaneContentSanitized,
  getAllTmuxPanes,
  getGitBranch,
  getGitRemoteUrl,
  getProcessCwd,
  getProcessStartTime,
  getProcessTable,
  getProjectName,
  isAlternateScreen,
  isTmuxAvailable,
  pastePath,
  sendEnter,
  sendInterrupt,
  sendLiteral,
  sendRawKey,
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
    const exec = () =>
      "%0 1234 main 0 0 /dev/pts/0\n%1 5678 work 1 0 /dev/pts/1\n%2 9012 work 1 1 /dev/pts/2";
    const panes = getAllTmuxPanes(exec);

    expect(panes).toHaveLength(3);
    expect(panes[0]).toEqual({
      pane_id: "%0",
      pane_pid: 1234,
      session_name: "main",
      window_index: 0,
      pane_index: 0,
      pane_tty: "/dev/pts/0",
    });
    expect(panes[1]).toEqual({
      pane_id: "%1",
      pane_pid: 5678,
      session_name: "work",
      window_index: 1,
      pane_index: 0,
      pane_tty: "/dev/pts/1",
    });
  });

  it("returns empty array when tmux fails", () => {
    const exec = () => {
      throw new Error("tmux error");
    };
    expect(getAllTmuxPanes(exec)).toEqual([]);
  });

  it("skips malformed lines", () => {
    const exec = () => "%0 1234 main 0 0 /dev/pts/0\nbadline\n%1 5678 work 1 0 /dev/pts/1";
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
        "  PID  PPID TT       COMMAND",
        "  100  1234 pts/0    claude",
        "  200  5678 pts/1    nvim /Users/test/.claude/CLAUDE.md",
        "  300     1 ?        /Applications/Claude.app/Contents/MacOS/Claude",
      ].join("\n");

    const table = getProcessTable(exec);
    expect(table).toHaveLength(3);
    expect(table[0]).toEqual({ pid: 100, ppid: 1234, command: "claude", tty: "pts/0" });
    expect(table[1]).toEqual({
      pid: 200,
      ppid: 5678,
      command: "nvim /Users/test/.claude/CLAUDE.md",
      tty: "pts/1",
    });
    expect(table[2]).toEqual({
      pid: 300,
      ppid: 1,
      command: "/Applications/Claude.app/Contents/MacOS/Claude",
      tty: undefined,
    });
  });

  it("treats macOS '??' tty column as no controlling terminal", () => {
    const exec = () =>
      ["  PID  PPID TT       COMMAND", "  100     1 ??       codex-acp"].join("\n");

    const table = getProcessTable(exec);
    expect(table).toHaveLength(1);
    expect(table[0]).toEqual({ pid: 100, ppid: 1, command: "codex-acp", tty: undefined });
  });

  it("returns empty array on failure", () => {
    const exec = () => {
      throw new Error("ps failed");
    };
    expect(getProcessTable(exec)).toEqual([]);
  });
});

describe("getProcessCwd", () => {
  it("uses /proc readlink when available", () => {
    const exec = (cmd: string) => {
      if (cmd.startsWith("readlink")) return "/home/user/project";
      throw new Error("should not reach lsof");
    };
    expect(getProcessCwd(1234, exec)).toBe("/home/user/project");
  });

  it("falls back to lsof when /proc is unavailable", () => {
    const exec = (cmd: string) => {
      if (cmd.startsWith("readlink")) throw new Error("no /proc");
      return "p1234\nfcwd\nn/Users/test/project";
    };
    expect(getProcessCwd(1234, exec)).toBe("/Users/test/project");
  });

  it("falls through to lsof when readlink returns empty string", () => {
    const exec = (cmd: string) => {
      if (cmd.startsWith("readlink")) return "";
      return "p1234\nfcwd\nn/fallback/path";
    };
    expect(getProcessCwd(1234, exec)).toBe("/fallback/path");
  });

  it("returns null when both methods fail", () => {
    const exec = () => {
      throw new Error("failed");
    };
    expect(getProcessCwd(1234, exec)).toBeNull();
  });

  it("returns null when no cwd line found in lsof", () => {
    const exec = (cmd: string) => {
      if (cmd.startsWith("readlink")) throw new Error("no /proc");
      return "p1234\nfother\n";
    };
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

describe("getGitRemoteUrl", () => {
  it("converts SCP-style SSH remote URL to GitHub HTTPS URL", () => {
    const exec = () => "git@github.com:user/my-repo.git";
    expect(getGitRemoteUrl("/some/path", exec)).toBe("https://github.com/user/my-repo");
  });

  it("converts ssh:// protocol URL to GitHub HTTPS URL", () => {
    const exec = () => "ssh://git@github.com/user/my-repo.git";
    expect(getGitRemoteUrl("/some/path", exec)).toBe("https://github.com/user/my-repo");
  });

  it("normalizes HTTPS remote URL", () => {
    const exec = () => "https://github.com/user/my-repo.git";
    expect(getGitRemoteUrl("/some/path", exec)).toBe("https://github.com/user/my-repo");
  });

  it("handles HTTPS URL without .git suffix", () => {
    const exec = () => "https://github.com/user/my-repo";
    expect(getGitRemoteUrl("/some/path", exec)).toBe("https://github.com/user/my-repo");
  });

  it("returns null for non-GitHub remote", () => {
    const exec = () => "git@gitlab.com:user/my-repo.git";
    expect(getGitRemoteUrl("/some/path", exec)).toBeNull();
  });

  it("returns null on failure", () => {
    const exec = () => {
      throw new Error("not a git repo");
    };
    expect(getGitRemoteUrl("/some/path", exec)).toBeNull();
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

describe("isAlternateScreen", () => {
  it("returns true when alternate_on is 1", () => {
    const exec = () => "1";
    expect(isAlternateScreen("%0", exec)).toBe(true);
  });

  it("returns false when alternate_on is 0", () => {
    const exec = () => "0";
    expect(isAlternateScreen("%0", exec)).toBe(false);
  });

  it("returns false on tmux error", () => {
    const exec = () => {
      throw new Error("tmux error");
    };
    expect(isAlternateScreen("%0", exec)).toBe(false);
  });
});

describe("capturePaneContentEscaped", () => {
  it("omits -a and -S flags when pane is in alternate screen mode", () => {
    const commands: string[] = [];
    const exec = (cmd: string) => {
      commands.push(cmd);
      if (cmd.includes("display-message")) return "1";
      return "\x1b[32malt content\x1b[0m";
    };

    const result = capturePaneContentEscaped("%0", exec);
    expect(result).toBe("\x1b[32malt content\x1b[0m");
    expect(commands[1]).not.toContain("-a");
    expect(commands[1]).not.toContain("-S -500");
  });

  it("uses -S -500 flag when pane is NOT in alternate screen mode", () => {
    const commands: string[] = [];
    const exec = (cmd: string) => {
      commands.push(cmd);
      if (cmd.includes("display-message")) return "0";
      return "scrollback content";
    };

    const result = capturePaneContentEscaped("%0", exec);
    expect(result).toBe("scrollback content");
    expect(commands[1]).toContain("-S -500");
    expect(commands[1]).not.toContain("-a");
  });

  it("escapes pane id in the command", () => {
    const commands: string[] = [];
    const exec = (cmd: string) => {
      commands.push(cmd);
      if (cmd.includes("display-message")) return "0";
      return "content";
    };

    capturePaneContentEscaped("%0", exec);
    for (const cmd of commands) {
      expect(cmd).toContain("'%0'");
    }
  });

  it("returns null on tmux error", () => {
    const exec = () => {
      throw new Error("tmux error");
    };
    expect(capturePaneContentEscaped("%0", exec)).toBeNull();
  });
});

describe("capturePaneContentSanitized", () => {
  it("returns sanitized content from escaped capture", () => {
    const exec = () => "\x1b[32mhello\x1b[0m world";
    const result = capturePaneContentSanitized("%0", exec);
    expect(result).toBe("hello world");
  });

  it("returns null when capture fails", () => {
    const exec = () => {
      throw new Error("tmux error");
    };
    expect(capturePaneContentSanitized("%0", exec)).toBeNull();
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

describe("sendLiteral", () => {
  it("sends literal text without Enter", () => {
    const commands: string[] = [];
    const exec = (cmd: string) => {
      commands.push(cmd);
      return "";
    };

    const result = sendLiteral("%0", " hello ", exec);
    expect(result).toBe(true);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain("send-keys");
    expect(commands[0]).toContain("-l");
    expect(commands[0]).toContain("'%0'");
    expect(commands[0]).toContain("' hello '");
    expect(commands[0]).not.toContain("Enter");
  });

  it("returns false on failure", () => {
    const exec = () => {
      throw new Error("pane not found");
    };
    expect(sendLiteral("%99", "x", exec)).toBe(false);
  });
});

describe("sendEnter", () => {
  it("sends a single Enter key without -l", () => {
    const commands: string[] = [];
    const exec = (cmd: string) => {
      commands.push(cmd);
      return "";
    };

    const result = sendEnter("%0", exec);
    expect(result).toBe(true);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain("send-keys");
    expect(commands[0]).toContain("Enter");
    expect(commands[0]).not.toContain("-l");
  });

  it("returns false on failure", () => {
    const exec = () => {
      throw new Error("pane not found");
    };
    expect(sendEnter("%99", exec)).toBe(false);
  });
});

describe("pastePath", () => {
  it("loads content via stdin then runs paste-buffer -p (in that order)", () => {
    type Event =
      | { kind: "stdin"; argv: readonly string[]; input: string }
      | { kind: "exec"; cmd: string };
    const events: Event[] = [];
    const exec = (cmd: string) => {
      events.push({ kind: "exec", cmd });
      return "";
    };
    const execWithStdin = (argv: readonly string[], input: string) => {
      events.push({ kind: "stdin", argv, input });
    };

    const result = pastePath("%0", "/abs/path.png", exec, execWithStdin);
    expect(result).toBe(true);
    expect(events).toHaveLength(2);
    // load-buffer MUST run before paste-buffer, otherwise tmux pastes stale
    // buffer contents.
    expect(events[0].kind).toBe("stdin");
    if (events[0].kind === "stdin") {
      expect(events[0].argv).toEqual(["tmux", "load-buffer", "-"]);
      expect(events[0].input).toBe("/abs/path.png");
    }
    expect(events[1].kind).toBe("exec");
    if (events[1].kind === "exec") {
      expect(events[1].cmd).toContain("tmux paste-buffer -p");
      expect(events[1].cmd).toContain("'%0'");
    }
  });

  it("does not call paste-buffer when load-buffer fails", () => {
    const execCalls: string[] = [];
    const exec = (cmd: string) => {
      execCalls.push(cmd);
      return "";
    };
    const execWithStdin = () => {
      throw new Error("load-buffer failed");
    };
    expect(pastePath("%0", "/abs/path.png", exec, execWithStdin)).toBe(false);
    expect(execCalls).toHaveLength(0);
  });

  it("returns false when paste-buffer fails", () => {
    const exec = () => {
      throw new Error("paste-buffer failed");
    };
    const execWithStdin = () => {};
    expect(pastePath("%0", "/abs/path.png", exec, execWithStdin)).toBe(false);
  });
});

describe("sendInterrupt", () => {
  it("sends space literal then C-c in correct order", () => {
    const commands: string[] = [];
    const exec = (cmd: string) => {
      commands.push(cmd);
      return "";
    };

    const result = sendInterrupt("%0", exec);
    expect(result).toBe(true);
    expect(commands).toHaveLength(2);
    expect(commands[0]).toContain("send-keys");
    expect(commands[0]).toContain("-l");
    expect(commands[0]).toContain("' '");
    expect(commands[1]).toContain("send-keys");
    expect(commands[1]).toContain("C-c");
    expect(commands[1]).not.toContain("-l");
  });

  it("escapes pane id in both commands", () => {
    const commands: string[] = [];
    const exec = (cmd: string) => {
      commands.push(cmd);
      return "";
    };

    sendInterrupt("%0", exec);
    expect(commands[0]).toContain("'%0'");
    expect(commands[1]).toContain("'%0'");
  });

  it("returns false on failure", () => {
    const exec = () => {
      throw new Error("pane not found");
    };

    expect(sendInterrupt("%99", exec)).toBe(false);
  });
});

describe("sendRawKey", () => {
  it("sends a named key without -l (literal) so tmux interprets it", () => {
    const commands: string[] = [];
    const exec = (cmd: string) => {
      commands.push(cmd);
      return "";
    };

    expect(sendRawKey("%0", "Left", exec)).toBe(true);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain("send-keys");
    expect(commands[0]).not.toContain("-l");
    expect(commands[0]).toContain("'Left'");
  });

  it("sends a single digit as one quoted argument (not a repeat-count)", () => {
    // A lone digit must reach tmux as the key argument '1', not be consumed as
    // a `-N` repeat count, so AskUserQuestion choice prompts receive the digit.
    const commands: string[] = [];
    const exec = (cmd: string) => {
      commands.push(cmd);
      return "";
    };

    sendRawKey("%0", "1", exec);
    expect(commands[0]).toContain("'1'");
    expect(commands[0]).not.toContain("-N");
  });

  it("escapes the pane id", () => {
    const commands: string[] = [];
    const exec = (cmd: string) => {
      commands.push(cmd);
      return "";
    };

    sendRawKey("%0", "Right", exec);
    expect(commands[0]).toContain("'%0'");
  });

  it("returns false on failure", () => {
    const exec = () => {
      throw new Error("pane not found");
    };

    expect(sendRawKey("%99", "Up", exec)).toBe(false);
  });
});
