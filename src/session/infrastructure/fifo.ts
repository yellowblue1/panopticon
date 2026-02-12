import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";

export function defaultCreateFifo(path: string): boolean {
  try {
    const result = Bun.spawnSync(["mkfifo", path], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 5000,
    });
    return result.success;
  } catch {
    return false;
  }
}

export function defaultSpawnFifoReader(path: string): ChildProcess {
  return spawn("cat", [path], {
    stdio: ["ignore", "pipe", "ignore"],
  });
}
