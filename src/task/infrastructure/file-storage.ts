import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { TaskStorageDeps } from "../domain/ports";
import type { Task } from "../domain/types";

const TASKS_PATH = join(homedir(), ".config", "panopticon", "tasks.json");

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function createTaskStorageDeps(): TaskStorageDeps {
  return {
    readTasks: (): Task[] => {
      if (!existsSync(TASKS_PATH)) return [];
      try {
        const raw = readFileSync(TASKS_PATH, "utf-8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
        return [];
      } catch {
        return [];
      }
    },

    writeTasks: (tasks: Task[]): void => {
      ensureDir(TASKS_PATH);
      writeFileSync(TASKS_PATH, JSON.stringify(tasks, null, 2), "utf-8");
    },

    watchFile: (callback: () => void): (() => void) => {
      ensureDir(TASKS_PATH);
      if (!existsSync(TASKS_PATH)) {
        writeFileSync(TASKS_PATH, "[]", "utf-8");
      }

      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      const DEBOUNCE_MS = 100;

      const watcher = watch(TASKS_PATH, { persistent: false }, () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(callback, DEBOUNCE_MS);
      });

      return () => {
        watcher.close();
        if (debounceTimer) clearTimeout(debounceTimer);
      };
    },
  };
}
