import type { ChildProcess } from "node:child_process";
import type { MonitoredProcess, ProcessInfo, TmuxPane } from "../../terminal/domain/types";

/**
 * Dependencies for the SessionManager.
 * All external operations are injected to enable testing.
 */
export interface SessionManagerDeps {
  isTmuxAvailable: () => boolean;
  getAllTmuxPanes: () => TmuxPane[];
  getProcessTable: () => ProcessInfo[];
  getMonitoredProcesses: (processTable: ProcessInfo[]) => MonitoredProcess[];
  getProcessCwd: (pid: number) => string | null;
  getProcessStartTime: (pid: number) => string | null;
  getProjectName: (cwd: string) => string;
  getGitRemoteUrl: (cwd: string) => string | null;
  buildTmuxTarget: (pane: TmuxPane) => string;
  matchProcessesToPanes: (
    processes: MonitoredProcess[],
    panes: TmuxPane[],
    processTable: ProcessInfo[],
  ) => Map<string, { process: MonitoredProcess; pane: TmuxPane }>;
  generateSummary: (content: string) => Promise<string | null>;
  /** Check if Gemini API is currently in an auth error state */
  isAuthError?: () => boolean;
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
