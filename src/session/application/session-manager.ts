import type { ChildProcess } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareWithHysteresis } from "../../shared/sort";
import type { SessionResponse } from "../../shared/types";
import type { MonitoredBinary, SessionState, TmuxPane } from "../../terminal/domain/types";
import { MONITORED_BINARY_AGENT_TYPES } from "../../terminal/domain/types";
import type { SessionManagerDeps, SessionManagerOptions } from "../domain/ports";

const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_IDLE_THRESHOLD_MS = 1000;
const DEFAULT_SUMMARY_DELAY_MS = 3_000; // 3 seconds debounce after entering WAITING
const DEFAULT_PANE_CHECK_INTERVAL_MS = 1000; // 1 second pane diff polling
const AUTH_ERROR_RETRY_MS = 60_000; // 60 seconds retry probe when auth is broken

/** State for a single FIFO-based pipe-pane monitor */
interface PipePaneState {
  fifoPath: string;
  readerProcess: ChildProcess;
}

/**
 * Manages coding agent session state via tmux polling + capture-pane content diffing.
 *
 * Session discovery: polls ps + tmux list-panes periodically.
 * Status detection: capture-pane polling detects visible content changes for both
 * WAITING → BUSY and BUSY → WAITING transitions. Pipe-pane (FIFO) provides
 * real-time activity signals for the pane content viewer (SSE streaming) but
 * does not affect session status — ANSI escape sequences flow through pipe-pane
 * even when idle, making it unreliable for status detection.
 * Summary generation: dual-condition — when WAITING AND tmux pane content is
 * static (unchanged between consecutive captures), triggers Gemini immediately.
 * Falls back to summaryDelayMs timeout if capture-pane is unavailable.
 * Content hash guard prevents redundant Gemini calls when content hasn't changed.
 */
export class SessionManager {
  private sessions = new Map<string, SessionState>();
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private summaryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pipePanes = new Map<string, PipePaneState>();
  private deps: SessionManagerDeps;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private paneCheckTimer: ReturnType<typeof setInterval> | null = null;
  private readonly pollIntervalMs: number;
  private readonly idleThresholdMs: number;
  private readonly summaryDelayMs: number;
  private readonly paneCheckIntervalMs: number;
  private onChangeCallback: (() => void) | null = null;
  private paneActivityCallback: ((paneId: string) => void) | null = null;

  constructor(deps: SessionManagerDeps, options?: SessionManagerOptions) {
    this.deps = deps;
    this.pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.idleThresholdMs = options?.idleThresholdMs ?? DEFAULT_IDLE_THRESHOLD_MS;
    this.summaryDelayMs = options?.summaryDelayMs ?? DEFAULT_SUMMARY_DELAY_MS;
    this.paneCheckIntervalMs = options?.paneCheckIntervalMs ?? DEFAULT_PANE_CHECK_INTERVAL_MS;
  }

  /**
   * Register a callback to be notified when session state changes
   */
  onChange(callback: () => void): void {
    this.onChangeCallback = callback;
  }

  /**
   * Register a callback to be notified when a pane has output activity.
   * Fires on every pipe-pane data event (callers should debounce as needed).
   */
  onPaneActivity(callback: (paneId: string) => void): void {
    this.paneActivityCallback = callback;
  }

  /**
   * Start the polling loop for session discovery
   */
  start(): void {
    if (this.pollTimer) return;
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), this.pollIntervalMs);
    this.paneCheckTimer = setInterval(() => this.checkPaneContent(), this.paneCheckIntervalMs);
  }

  /**
   * Stop the polling loop and clean up resources
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.paneCheckTimer) {
      clearInterval(this.paneCheckTimer);
      this.paneCheckTimer = null;
    }
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();
    for (const timer of this.summaryTimers.values()) {
      clearTimeout(timer);
    }
    this.summaryTimers.clear();
    for (const paneId of this.pipePanes.keys()) {
      this.teardownPipePane(paneId);
    }
  }

  /**
   * Get all sessions sorted by last activity (most recent first)
   */
  getSessions(): SessionResponse[] {
    const sessions = Array.from(this.sessions.values());

    sessions.sort((a, b) =>
      compareWithHysteresis(a.last_activity, b.last_activity, a.pane_id.localeCompare(b.pane_id)),
    );

    return sessions.map((s) => ({
      pane_id: s.pane_id,
      project_name: s.project_name,
      git_branch: s.git_branch,
      github_repo_url: s.github_repo_url,
      status: s.status,
      summary: s.status === "busy" ? null : s.summary,
      tmux_target: s.tmux_target,
      tmux_session_name: s.tmux_session_name,
      last_activity: s.last_activity,
      agent_type: s.agent_type,
      cwd: s.cwd,
    }));
  }

  /**
   * Get the working directory for a session by pane ID.
   * Returns the cwd from internal state without exposing the full SessionState.
   */
  getSessionCwd(paneId: string): string | null {
    return this.sessions.get(paneId)?.cwd ?? null;
  }

  /**
   * Get a single session by pane ID
   */
  getSession(paneId: string): SessionResponse | null {
    const state = this.sessions.get(paneId);
    if (!state) return null;

    return {
      pane_id: state.pane_id,
      project_name: state.project_name,
      git_branch: state.git_branch,
      github_repo_url: state.github_repo_url,
      status: state.status,
      summary: state.status === "busy" ? null : state.summary,
      tmux_target: state.tmux_target,
      tmux_session_name: state.tmux_session_name,
      last_activity: state.last_activity,
      agent_type: state.agent_type,
      cwd: state.cwd,
    };
  }

  /**
   * Main polling loop - discover/remove sessions only.
   * Status detection is handled by capture-pane content diffing.
   */
  private poll(): void {
    if (!this.deps.isTmuxAvailable()) {
      if (this.sessions.size > 0) {
        this.cleanupAllSessions();
        this.notifyChange();
      }
      return;
    }

    const panes = this.deps.getAllTmuxPanes();
    const processTable = this.deps.getProcessTable();
    const processes = this.deps.getMonitoredProcesses(processTable);
    const matches = this.deps.matchProcessesToPanes(processes, panes, processTable);

    const foundPanes = new Set<string>();
    let changed = false;

    for (const [paneId, { process, pane }] of matches) {
      foundPanes.add(paneId);
      try {
        const existing = this.sessions.get(paneId);
        if (!existing) {
          const didCreate = this.createSession(paneId, process.pid, pane, process.binaryName);
          if (didCreate) changed = true;
        } else if (existing.process_pid !== process.pid) {
          // Monitored process changed in this pane — recreate session with fresh metadata
          this.removeSession(paneId);
          const didCreate = this.createSession(paneId, process.pid, pane, process.binaryName);
          if (didCreate) changed = true;
        }
      } catch {
        // Continue processing other panes — one pane's error should not
        // prevent cleanup of stale sessions in the loop below
      }
    }

    // Remove sessions whose panes no longer exist
    for (const paneId of this.sessions.keys()) {
      if (!foundPanes.has(paneId)) {
        this.removeSession(paneId);
        changed = true;
      }
    }

    if (changed) {
      this.notifyChange();
    }
  }

  /**
   * Create a new session and set up pipe-pane activity detection
   */
  private createSession(
    paneId: string,
    processPid: number,
    pane: TmuxPane,
    binaryName: MonitoredBinary,
  ): boolean {
    const cwd = this.deps.getProcessCwd(processPid);
    if (!cwd) return false;

    this.sessions.set(paneId, {
      pane_id: paneId,
      process_pid: processPid,
      agent_type: MONITORED_BINARY_AGENT_TYPES[binaryName],
      cwd,
      project_name: this.deps.getProjectName(cwd),
      git_branch: this.deps.getGitBranch(cwd),
      github_repo_url: this.deps.getGitRemoteUrl(cwd),
      status: "busy",
      summary: null,
      tmux_target: this.deps.buildTmuxTarget(pane),
      tmux_session_name: pane.session_name,
      last_activity: this.deps.getProcessStartTime(processPid) ?? new Date().toISOString(),
      previousPaneContent: this.deps.capturePaneContent(paneId) ?? null,
      summary_pending: false,
      pipePaneActive: false,
      summaryContentHash: null,
    });

    // Set up pipe-pane for real-time activity detection
    this.setupPipePane(paneId);

    // Start idle timer
    this.resetIdleTimer(paneId);

    return true;
  }

  /**
   * Remove a session and clean up its resources
   */
  private removeSession(paneId: string): void {
    this.sessions.delete(paneId);
    this.teardownPipePane(paneId);
    const idleTimer = this.idleTimers.get(paneId);
    if (idleTimer) {
      clearTimeout(idleTimer);
      this.idleTimers.delete(paneId);
    }
    this.cancelSummaryTimer(paneId);
  }

  /**
   * Clean up all sessions
   */
  private cleanupAllSessions(): void {
    for (const paneId of this.sessions.keys()) {
      this.teardownPipePane(paneId);
      const idleTimer = this.idleTimers.get(paneId);
      if (idleTimer) clearTimeout(idleTimer);
    }
    this.sessions.clear();
    this.idleTimers.clear();
    for (const timer of this.summaryTimers.values()) {
      clearTimeout(timer);
    }
    this.summaryTimers.clear();
  }

  /**
   * Reset the idle timer for a session
   */
  private resetIdleTimer(paneId: string): void {
    const existing = this.idleTimers.get(paneId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.onIdleTimeout(paneId);
    }, this.idleThresholdMs);

    this.idleTimers.set(paneId, timer);
  }

  /**
   * Called when idle timer expires — transition to WAITING
   */
  private onIdleTimeout(paneId: string): void {
    this.idleTimers.delete(paneId);
    const session = this.sessions.get(paneId);
    if (!session || session.status !== "busy") return;

    session.status = "waiting";
    session.last_activity = new Date().toISOString();
    this.notifyChange();

    // Schedule summary generation after debounce period.
    // This is the sole trigger path for summaries — if the session goes
    // BUSY before the timer fires, it gets cancelled and reset on next WAITING.
    this.scheduleSummaryTimer(paneId);
  }

  /**
   * Schedule a summary generation after a debounce delay.
   * This is the sole trigger for Gemini calls — fires only if the session
   * is still WAITING when the timer expires. Cancelled on BUSY transition.
   */
  private scheduleSummaryTimer(paneId: string, delayMs?: number): void {
    this.cancelSummaryTimer(paneId);

    const timer = setTimeout(() => {
      this.summaryTimers.delete(paneId);
      const session = this.sessions.get(paneId);
      if (session?.status === "waiting") {
        // Reset summary_pending so generateSummaryAsync can proceed.
        // This is needed for retry-after-failure: the previous attempt
        // may have left summary_pending = true to block checkPaneContent.
        session.summary_pending = false;
        this.generateSummaryAsync(paneId);
      }
    }, delayMs ?? this.summaryDelayMs);

    this.summaryTimers.set(paneId, timer);
  }

  /**
   * Cancel a pending summary timer
   */
  private cancelSummaryTimer(paneId: string): void {
    const timer = this.summaryTimers.get(paneId);
    if (timer) {
      clearTimeout(timer);
      this.summaryTimers.delete(paneId);
    }
  }

  /**
   * Generate AI summary in background for a waiting session.
   * Uses pane content as the source for summaries.
   * Guards against duplicate invocations via summary_pending flag.
   */
  private async generateSummaryAsync(paneId: string): Promise<void> {
    const session = this.sessions.get(paneId);
    if (!session) return;

    // Atomic guard: if already pending, skip. Otherwise claim the slot.
    if (session.summary_pending) return;
    session.summary_pending = true;

    const content = this.deps.capturePaneContentForSummary(session.pane_id);

    if (!content) {
      session.summary_pending = false;
      return;
    }

    // Content hash guard: skip Gemini call if content hasn't changed since last summary
    const currentHash = simpleHash(content);
    if (
      session.summaryContentHash !== null &&
      currentHash === session.summaryContentHash &&
      session.summary !== null
    ) {
      session.summary_pending = true;
      this.notifyChange();
      return;
    }

    try {
      const summary = await this.deps.generateSummary(content);
      const current = this.sessions.get(paneId);
      if (!current) {
        return;
      }

      if (summary !== null) {
        // Store summary regardless of current status. The API already filters
        // out summaries for BUSY sessions (returns null), so stale data is
        // never shown. This prevents summaries from getting stuck in active
        // conversations where the session transitions to BUSY during the call.
        current.summary = summary;
        current.summaryContentHash = currentHash;
        // Keep summary_pending = true to prevent re-triggering in the same
        // WAITING period. It resets to false when the session goes BUSY.
        this.notifyChange();
      } else if (current.status === "waiting") {
        // Gemini returned null (error, auth failure, empty response, etc.).
        // Don't update summaryContentHash — don't cache failed results.
        if (this.deps.isAuthError?.()) {
          // Auth error: slow retry probe (60s) to detect recovery.
          // Reset summary_pending so the probe can proceed when it fires.
          current.summary_pending = false;
          this.scheduleSummaryTimer(paneId, AUTH_ERROR_RETRY_MS);
          this.notifyChange();
        } else {
          // Non-auth failure: retry after summaryDelayMs.
          this.scheduleSummaryTimer(paneId);
        }
      }
    } catch {
      const current = this.sessions.get(paneId);
      if (current) {
        current.summary_pending = false;
      }
    }
  }

  /**
   * Set up FIFO-based pipe-pane for real-time activity detection.
   * Creates a named pipe, starts a reader process, then starts tmux pipe-pane.
   */
  private setupPipePane(paneId: string): void {
    // Clean up any existing pipe for this pane
    this.teardownPipePane(paneId);

    const id = paneId.replace("%", "");
    const fifoPath = join(tmpdir(), `panopticon-pipe-${id}-${Date.now()}.fifo`);

    // Create FIFO
    if (!this.deps.createFifo(fifoPath)) {
      return; // FIFO creation failed — fall back to polling
    }

    // Open reader FIRST to prevent writer blocking
    const readerProcess = this.deps.spawnFifoReader(fifoPath);

    readerProcess.stdout?.on("data", () => {
      this.onPipePaneActivity(paneId);
    });

    readerProcess.on("error", () => {
      // Reader failed — clean up and fall back to polling
      this.teardownPipePane(paneId);
    });

    this.pipePanes.set(paneId, { fifoPath, readerProcess });

    // Detect unexpected reader exit (e.g. tmux pane destroyed → FIFO EOF)
    readerProcess.on("exit", () => {
      // Guard: teardownPipePane deletes from pipePanes synchronously
      // before killing the reader, so this won't fire for intentional teardowns
      if (this.pipePanes.has(paneId) && this.sessions.has(paneId)) {
        this.removeSession(paneId);
        this.notifyChange();
      }
    });

    // Start pipe-pane → FIFO
    const started = this.deps.startPipePane(paneId, fifoPath);
    if (started) {
      const session = this.sessions.get(paneId);
      if (session) session.pipePaneActive = true;
    } else {
      // pipe-pane failed — clean up
      this.teardownPipePane(paneId);
    }
  }

  /**
   * Tear down pipe-pane and clean up FIFO for a session.
   */
  private teardownPipePane(paneId: string): void {
    const state = this.pipePanes.get(paneId);
    if (!state) return;

    // Remove from map FIRST to signal intentional teardown.
    // The exit handler checks pipePanes.has() to distinguish
    // intentional teardown from unexpected pane destruction.
    this.pipePanes.delete(paneId);

    // Cancel tmux pipe-pane
    this.deps.stopPipePane(paneId);

    // Kill reader process — SIGTERM first, escalate to SIGKILL if needed.
    // On macOS, cat blocked on a FIFO read may not respond to SIGTERM.
    state.readerProcess.kill("SIGTERM");
    setTimeout(() => {
      try {
        state.readerProcess.kill("SIGKILL");
      } catch {
        // Process already exited — ignore
      }
    }, 500);

    // Remove FIFO
    try {
      if (existsSync(state.fifoPath)) {
        unlinkSync(state.fifoPath);
      }
    } catch {
      // Best effort cleanup
    }

    const session = this.sessions.get(paneId);
    if (session) session.pipePaneActive = false;
  }

  /**
   * Called when pipe-pane receives any output.
   * Updates activity timestamp and fires the pane activity callback (for SSE
   * content streaming), but does NOT change session status. ANSI escape
   * sequences flow through pipe-pane even when the session is idle, so
   * pipe-pane data is unreliable for status detection. Only visible content
   * changes (detected by checkPaneContent) drive status transitions.
   */
  private onPipePaneActivity(paneId: string): void {
    const session = this.sessions.get(paneId);
    if (!session) return;

    session.last_activity = new Date().toISOString();
    this.paneActivityCallback?.(paneId);
  }

  /**
   * Check pane content for all sessions.
   * Detects visible content changes for WAITING → BUSY transition and resets the
   * idle timer on changes to prevent premature BUSY → WAITING. This is the sole
   * mechanism for status transitions — pipe-pane is not used for status detection.
   */
  private checkPaneContent(): void {
    for (const [paneId, session] of this.sessions) {
      try {
        const content = this.deps.capturePaneContent(session.pane_id);
        if (content === null) continue;

        const isContentChanged =
          session.previousPaneContent !== null && content !== session.previousPaneContent;
        session.previousPaneContent = content;

        if (isContentChanged) {
          if (session.status === "waiting") {
            session.status = "busy";
            session.last_activity = new Date().toISOString();
            session.summary_pending = false;
            this.cancelSummaryTimer(paneId);
            this.notifyChange();
          }
          this.resetIdleTimer(paneId);
          this.paneActivityCallback?.(paneId);
        } else if (session.status === "busy" && !this.idleTimers.has(paneId)) {
          // Safety net: if session is BUSY but has no idle timer running,
          // start one to prevent getting stuck in BUSY indefinitely.
          this.resetIdleTimer(paneId);
        }
      } catch {
        // Best effort — skip this pane and continue with others
      }
    }
  }

  private notifyChange(): void {
    this.onChangeCallback?.();
  }
}

/**
 * Simple string hash for content deduplication (DJB2 algorithm).
 * Not cryptographic — only used to detect content changes.
 */
function simpleHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0; // Convert to unsigned 32-bit integer
}
