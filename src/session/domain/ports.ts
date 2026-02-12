import type { ChildProcess } from "node:child_process";
import type { ClaudeProcess, ProcessInfo, TmuxPane } from "../../terminal/domain/types";

/**
 * Dependencies for the SessionManager.
 * All external operations are injected to enable testing.
 */
export interface SessionManagerDeps {
  isTmuxAvailable: () => boolean;
  getAllTmuxPanes: () => TmuxPane[];
  getProcessTable: () => ProcessInfo[];
  getClaudeProcesses: (processTable: ProcessInfo[]) => ClaudeProcess[];
  getProcessCwd: (pid: number) => string | null;
  getProcessStartTime: (pid: number) => string | null;
  getProjectName: (cwd: string) => string;
  getGitBranch: (cwd: string) => string | null;
  buildTmuxTarget: (pane: TmuxPane) => string;
  matchProcessesToPanes: (
    processes: ClaudeProcess[],
    panes: TmuxPane[],
    processTable: ProcessInfo[],
  ) => Map<string, { process: ClaudeProcess; pane: TmuxPane }>;
  generateSummary: (content: string) => Promise<string | null>;
  capturePaneContent: (paneId: string) => string | null;
  capturePaneContentForSummary: (paneId: string) => string | null;
  startPipePane: (paneId: string, target: string) => boolean;
  stopPipePane: (paneId: string) => boolean;
  createFifo: (path: string) => boolean;
  spawnFifoReader: (path: string) => ChildProcess;
}

export interface SessionManagerOptions {
  pollIntervalMs?: number;
  idleThresholdMs?: number;
  summaryDelayMs?: number;
  paneCheckIntervalMs?: number;
}
