import type { Task } from "./types";

export interface TaskStorageDeps {
  readTasks: () => Task[];
  writeTasks: (tasks: Task[]) => void;
  watchFile: (callback: () => void) => () => void;
}
