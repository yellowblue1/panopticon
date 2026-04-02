import type { ProcessInfo, TmuxPane } from "../domain/types";
import { sanitizePaneContent } from "./sanitize";

/**
 * Escape a string for safe use in shell commands.
 * Uses single quotes and escapes any embedded single quotes.
 */
function shellEscape(str: string): string {
  return `'${str.replace(/'/g, "'\\''")}'`;
}

type ExecFn = (command: string) => string;

const defaultExec: ExecFn = (command: string) => {
  const result = Bun.spawnSync(["sh", "-c", command], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 5000,
  });
  if (!result.success) {
    const stderr = result.stderr.toString().trim();
    throw new Error(stderr || `Command failed with exit code ${result.exitCode}`);
  }
  return result.stdout.toString().trim();
};

/**
 * Check if tmux is available and running
 */
export function isTmuxAvailable(exec: ExecFn = defaultExec): boolean {
  try {
    exec("tmux list-sessions");
    return true;
  } catch {
    return false;
  }
}

/**
 * Get all tmux panes with their PIDs
 */
export function getAllTmuxPanes(exec: ExecFn = defaultExec): TmuxPane[] {
  try {
    const output = exec(
      "tmux list-panes -a -F '#{pane_id} #{pane_pid} #{session_name} #{window_index} #{pane_index}'",
    );
    return output
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(" ");
        if (parts.length < 5) return null;
        return {
          pane_id: parts[0],
          pane_pid: Number.parseInt(parts[1], 10),
          session_name: parts[2],
          window_index: Number.parseInt(parts[3], 10),
          pane_index: Number.parseInt(parts[4], 10),
        };
      })
      .filter((p): p is TmuxPane => p !== null && !Number.isNaN(p.pane_pid));
  } catch {
    return [];
  }
}

/**
 * Get the full process table from ps.
 * Returns all processes with PID, PPID, and command.
 */
export function getProcessTable(exec: ExecFn = defaultExec): ProcessInfo[] {
  try {
    const output = exec("ps -eo pid,ppid,command");
    return output
      .split("\n")
      .slice(1) // skip header line
      .filter(Boolean)
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 3) return null;
        const pid = Number.parseInt(parts[0], 10);
        const ppid = Number.parseInt(parts[1], 10);
        if (Number.isNaN(pid) || Number.isNaN(ppid)) return null;
        return { pid, ppid, command: parts.slice(2).join(" ") };
      })
      .filter((p): p is ProcessInfo => p !== null);
  } catch {
    return [];
  }
}

/**
 * Get the start time of a process as an ISO 8601 string via `ps -o lstart=`.
 * Returns null if the process doesn't exist or the command fails.
 */
export function getProcessStartTime(pid: number, exec: ExecFn = defaultExec): string | null {
  try {
    const output = exec(`ps -o lstart= -p ${pid}`);
    if (!output) return null;
    const date = new Date(output);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  } catch {
    return null;
  }
}

/**
 * Get the current working directory of a process.
 * Tries /proc/<pid>/cwd first (Linux, no extra tools needed),
 * then falls back to lsof (macOS / systems without procfs).
 */
export function getProcessCwd(pid: number, exec: ExecFn = defaultExec): string | null {
  // Try /proc first — works in Docker and minimal Linux environments without lsof
  try {
    const cwd = exec(`readlink /proc/${pid}/cwd`);
    if (cwd) return cwd;
  } catch {
    // /proc not available — fall through to lsof
  }

  try {
    const output = exec(`lsof -a -p ${pid} -d cwd -Fn`);
    // lsof -Fn outputs lines starting with 'n' for the name field
    const lines = output.split("\n");
    for (const line of lines) {
      if (line.startsWith("n") && line.length > 1) {
        return line.slice(1);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get project name from CWD using git remote
 */
export function getProjectName(cwd: string, exec: ExecFn = defaultExec): string {
  try {
    const remoteUrl = exec(`git -C ${shellEscape(cwd)} remote get-url origin`);

    // Parse SSH URL: git@github.com:user/repo.git -> repo
    const sshMatch = remoteUrl.match(/[:/]([^/]+?)(?:\.git)?$/);
    if (sshMatch) {
      return sshMatch[1].replace(/\.git$/, "");
    }

    // Parse HTTPS URL: https://github.com/user/repo.git -> repo
    const httpsMatch = remoteUrl.match(/\/([^/]+?)(?:\.git)?$/);
    if (httpsMatch) {
      return httpsMatch[1].replace(/\.git$/, "");
    }
  } catch {
    // Fall through to basename
  }

  // Fallback: basename of cwd
  return cwd.split("/").pop() || cwd;
}

/**
 * Get the GitHub repository HTTPS URL from the git remote origin.
 * Handles multiple SSH URL formats and HTTPS. Returns null for
 * non-GitHub repos or when git is unavailable.
 */
export function getGitRemoteUrl(cwd: string, exec: ExecFn = defaultExec): string | null {
  try {
    const remoteUrl = exec(`git -C ${shellEscape(cwd)} remote get-url origin`);

    // SCP format: git@github.com:owner/repo.git
    const scpMatch = remoteUrl.match(/git@github\.com:(.+?)(?:\.git)?$/);
    if (scpMatch) {
      return `https://github.com/${scpMatch[1]}`;
    }

    // SSH protocol format: ssh://git@github.com/owner/repo.git
    const sshMatch = remoteUrl.match(/ssh:\/\/git@github\.com\/(.+?)(?:\.git)?$/);
    if (sshMatch) {
      return `https://github.com/${sshMatch[1]}`;
    }

    // HTTPS format: https://github.com/owner/repo.git
    const httpsMatch = remoteUrl.match(/^(https?:\/\/github\.com\/.+?)(?:\.git)?$/);
    if (httpsMatch) {
      return httpsMatch[1];
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Get current git branch
 */
export function getGitBranch(cwd: string, exec: ExecFn = defaultExec): string | null {
  try {
    return exec(`git -C ${shellEscape(cwd)} rev-parse --abbrev-ref HEAD`) || null;
  } catch {
    return null;
  }
}

/**
 * Send text to a tmux pane followed by Enter key press.
 * Uses -l flag to send text literally (avoiding key-name interpretation),
 * then sends Enter as a separate command to ensure proper submission.
 */
export function sendKeys(paneId: string, text: string, exec: ExecFn = defaultExec): boolean {
  try {
    const target = shellEscape(paneId);
    exec(`tmux send-keys -t ${target} -l ${shellEscape(text)}`);
    exec(`tmux send-keys -t ${target} Enter`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Send a raw tmux key name to a pane (e.g. Escape, Enter, C-c).
 * Unlike sendKeys(), this does NOT use -l (literal) mode and does NOT append Enter.
 */
export function sendRawKey(paneId: string, key: string, exec: ExecFn = defaultExec): boolean {
  try {
    exec(`tmux send-keys -t ${shellEscape(paneId)} ${shellEscape(key)}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Send a safe interrupt (C-c) to a tmux pane.
 * Inserts a space character before C-c to prevent session termination
 * when the input line is empty (Claude Code exits on C-c with empty input).
 * Both commands execute synchronously with no async yield between them.
 */
export function sendInterrupt(paneId: string, exec: ExecFn = defaultExec): boolean {
  try {
    const target = shellEscape(paneId);
    exec(`tmux send-keys -t ${target} -l ' '`);
    exec(`tmux send-keys -t ${target} C-c`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Switch the current tmux client to the specified pane.
 * Uses `tmux switch-client -t <pane_id>` to change the active pane
 * in the user's terminal.
 */
export function switchClient(paneId: string, exec: ExecFn = defaultExec): boolean {
  try {
    exec(`tmux switch-client -t ${shellEscape(paneId)}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Capture the current visible content of a tmux pane.
 * Used for diff-based idle detection — if content doesn't change between
 * two consecutive captures, the pane is considered static.
 */
export function capturePaneContent(paneId: string, exec: ExecFn = defaultExec): string | null {
  try {
    return exec(`tmux capture-pane -p -t ${shellEscape(paneId)}`);
  } catch {
    return null;
  }
}

/**
 * Capture pane content with ANSI escape sequences preserved.
 * Uses -e flag to include color/style codes for terminal rendering.
 *
 * Detects whether the pane is in alternate screen mode (smcup/rmcup)
 * and adjusts capture strategy:
 * - Alternate screen ON: uses -a flag to capture the alternate buffer
 * - Alternate screen OFF: captures 500 lines of scrollback history (-S -500)
 */
export function capturePaneContentEscaped(
  paneId: string,
  exec: ExecFn = defaultExec,
): string | null {
  try {
    const target = shellEscape(paneId);
    return exec(
      `alt=$(tmux display-message -p -t ${target} '#{alternate_on}' 2>/dev/null); ` +
        `if [ "$alt" = "1" ]; then ` +
        `tmux capture-pane -p -e -a -t ${target}; ` +
        `else ` +
        `tmux capture-pane -p -e -S -500 -t ${target}; ` +
        `fi`,
    );
  } catch {
    return null;
  }
}

/**
 * Capture pane content with ANSI escapes, then sanitize:
 * strips dim/faint text (autocomplete suggestions) and remaining ANSI codes.
 * Used for Gemini summarization where ghost text should be excluded.
 */
export function capturePaneContentSanitized(
  paneId: string,
  exec: ExecFn = defaultExec,
): string | null {
  const raw = capturePaneContentEscaped(paneId, exec);
  return raw ? sanitizePaneContent(raw) : null;
}

/**
 * Start piping a tmux pane's output to a target (e.g., a FIFO).
 * Uses -o flag for output-only mode (excludes keyboard input).
 * Calling this again on the same pane replaces the existing pipe.
 */
export function startPipePane(paneId: string, target: string, exec: ExecFn = defaultExec): boolean {
  try {
    exec(`tmux pipe-pane -o -t ${shellEscape(paneId)} ${shellEscape(`cat > ${target}`)}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop piping a tmux pane's output.
 * Calling pipe-pane with no command argument cancels the existing pipe.
 */
export function stopPipePane(paneId: string, exec: ExecFn = defaultExec): boolean {
  try {
    exec(`tmux pipe-pane -t ${shellEscape(paneId)}`);
    return true;
  } catch {
    return false;
  }
}
