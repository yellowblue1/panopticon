import type { TaskStorageDeps } from "../domain/ports";
import type { Task, TaskStatus } from "../domain/types";

interface CreateTaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
}

interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  order?: number;
}

export function getAllTasks(deps: TaskStorageDeps): Task[] {
  return deps.readTasks();
}

export function createTask(input: CreateTaskInput, deps: TaskStorageDeps): Task {
  const tasks = deps.readTasks();
  const now = new Date().toISOString();
  const status = input.status ?? "todo";

  const columnTasks = tasks.filter((t) => t.status === status);
  const maxOrder = columnTasks.length > 0 ? Math.max(...columnTasks.map((t) => t.order)) : -1;

  const task: Task = {
    id: crypto.randomUUID(),
    title: input.title,
    description: input.description ?? "",
    status,
    order: maxOrder + 1,
    createdAt: now,
    updatedAt: now,
  };

  deps.writeTasks([...tasks, task]);
  return task;
}

export function updateTask(id: string, input: UpdateTaskInput, deps: TaskStorageDeps): Task | null {
  const tasks = deps.readTasks();
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return null;

  const existing = tasks[index];
  const updated: Task = {
    ...existing,
    ...input,
    updatedAt: new Date().toISOString(),
  };

  const newTasks = [...tasks];
  newTasks[index] = updated;
  deps.writeTasks(newTasks);
  return updated;
}

export function deleteTask(id: string, deps: TaskStorageDeps): boolean {
  const tasks = deps.readTasks();
  const filtered = tasks.filter((t) => t.id !== id);
  if (filtered.length === tasks.length) return false;
  deps.writeTasks(filtered);
  return true;
}

export function reorderTasks(taskIds: string[], status: TaskStatus, deps: TaskStorageDeps): Task[] {
  const tasks = deps.readTasks();
  const now = new Date().toISOString();

  const updated = tasks.map((task) => {
    const orderIndex = taskIds.indexOf(task.id);
    if (orderIndex === -1) return task;
    return { ...task, status, order: orderIndex, updatedAt: now };
  });

  deps.writeTasks(updated);
  return updated;
}
