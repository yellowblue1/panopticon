import { describe, expect, it } from "bun:test";
import type { TaskStorageDeps } from "../domain/ports";
import type { Task } from "../domain/types";
import { createTask, deleteTask, getAllTasks, reorderTasks, updateTask } from "./task-manager";

function createMockDeps(initialTasks: Task[] = []): TaskStorageDeps {
  let tasks = [...initialTasks];
  return {
    readTasks: () => [...tasks],
    writeTasks: (newTasks) => {
      tasks = [...newTasks];
    },
    watchFile: () => () => {},
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: crypto.randomUUID(),
    title: "Test task",
    description: "",
    status: "todo",
    order: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("getAllTasks", () => {
  it("returns empty array when no tasks exist", () => {
    const deps = createMockDeps();
    expect(getAllTasks(deps)).toEqual([]);
  });

  it("returns all tasks", () => {
    const tasks = [makeTask({ title: "A" }), makeTask({ title: "B" })];
    const deps = createMockDeps(tasks);
    expect(getAllTasks(deps)).toHaveLength(2);
  });
});

describe("createTask", () => {
  it("creates a task with defaults", () => {
    const deps = createMockDeps();
    const task = createTask({ title: "New task" }, deps);

    expect(task.title).toBe("New task");
    expect(task.description).toBe("");
    expect(task.status).toBe("todo");
    expect(task.order).toBe(0);
    expect(task.id).toBeDefined();
    expect(task.createdAt).toBeDefined();
    expect(task.updatedAt).toBe(task.createdAt);
  });

  it("creates a task with specified status", () => {
    const deps = createMockDeps();
    const task = createTask({ title: "In progress", status: "in_progress" }, deps);
    expect(task.status).toBe("in_progress");
  });

  it("calculates order as max + 1 within column", () => {
    const existing = [
      makeTask({ status: "todo", order: 0 }),
      makeTask({ status: "todo", order: 2 }),
    ];
    const deps = createMockDeps(existing);
    const task = createTask({ title: "Third" }, deps);
    expect(task.order).toBe(3);
  });

  it("starts order at 0 for empty column", () => {
    const existing = [makeTask({ status: "done", order: 5 })];
    const deps = createMockDeps(existing);
    const task = createTask({ title: "First todo" }, deps);
    expect(task.order).toBe(0);
  });

  it("persists created task", () => {
    const deps = createMockDeps();
    createTask({ title: "Persisted" }, deps);
    expect(getAllTasks(deps)).toHaveLength(1);
    expect(getAllTasks(deps)[0].title).toBe("Persisted");
  });
});

describe("updateTask", () => {
  it("updates title and description", () => {
    const task = makeTask({ title: "Old" });
    const deps = createMockDeps([task]);
    const updated = updateTask(task.id, { title: "New", description: "Updated" }, deps);

    expect(updated).not.toBeNull();
    expect(updated?.title).toBe("New");
    expect(updated?.description).toBe("Updated");
    expect(updated?.updatedAt).not.toBe(task.updatedAt);
  });

  it("returns null for non-existent id", () => {
    const deps = createMockDeps();
    expect(updateTask("non-existent", { title: "X" }, deps)).toBeNull();
  });

  it("preserves unchanged fields", () => {
    const task = makeTask({ title: "Keep", description: "Keep this" });
    const deps = createMockDeps([task]);
    const updated = updateTask(task.id, { title: "Changed" }, deps);

    expect(updated?.description).toBe("Keep this");
    expect(updated?.status).toBe("todo");
  });

  it("persists update", () => {
    const task = makeTask({ title: "Before" });
    const deps = createMockDeps([task]);
    updateTask(task.id, { title: "After" }, deps);
    expect(getAllTasks(deps)[0].title).toBe("After");
  });
});

describe("deleteTask", () => {
  it("deletes existing task", () => {
    const task = makeTask();
    const deps = createMockDeps([task]);
    expect(deleteTask(task.id, deps)).toBe(true);
    expect(getAllTasks(deps)).toHaveLength(0);
  });

  it("returns false for non-existent id", () => {
    const deps = createMockDeps();
    expect(deleteTask("non-existent", deps)).toBe(false);
  });

  it("preserves other tasks", () => {
    const keep = makeTask({ title: "Keep" });
    const remove = makeTask({ title: "Remove" });
    const deps = createMockDeps([keep, remove]);
    deleteTask(remove.id, deps);
    expect(getAllTasks(deps)).toHaveLength(1);
    expect(getAllTasks(deps)[0].title).toBe("Keep");
  });
});

describe("reorderTasks", () => {
  it("reorders tasks within same column", () => {
    const a = makeTask({ title: "A", status: "todo", order: 0 });
    const b = makeTask({ title: "B", status: "todo", order: 1 });
    const c = makeTask({ title: "C", status: "todo", order: 2 });
    const deps = createMockDeps([a, b, c]);

    reorderTasks([c.id, a.id, b.id], "todo", deps);
    const tasks = getAllTasks(deps);

    const reordered = tasks.sort((x, y) => x.order - y.order);
    expect(reordered[0].title).toBe("C");
    expect(reordered[1].title).toBe("A");
    expect(reordered[2].title).toBe("B");
  });

  it("moves task to different column", () => {
    const task = makeTask({ status: "todo", order: 0 });
    const deps = createMockDeps([task]);

    reorderTasks([task.id], "done", deps);
    const updated = getAllTasks(deps)[0];
    expect(updated.status).toBe("done");
    expect(updated.order).toBe(0);
  });

  it("does not affect tasks not in taskIds", () => {
    const a = makeTask({ title: "A", status: "todo", order: 0 });
    const b = makeTask({ title: "B", status: "done", order: 0 });
    const deps = createMockDeps([a, b]);

    reorderTasks([a.id], "in_progress", deps);
    const tasks = getAllTasks(deps);
    const bTask = tasks.find((t) => t.id === b.id);
    expect(bTask).toBeDefined();
    expect(bTask?.status).toBe("done");
    expect(bTask?.order).toBe(0);
  });
});
