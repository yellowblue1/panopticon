import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TaskResponse, TaskStatus } from "@shared/types";
import { createFileRoute } from "@tanstack/react-router";
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  useCreateTask,
  useDeleteTask,
  useReorderTasks,
  useTasks,
  useUpdateTask,
} from "@/hooks/use-tasks";
import { useTasksStream } from "@/hooks/use-tasks-stream";
import { cn } from "@/lib/cn";

export const Route = createFileRoute("/tasks")({
  component: TasksPage,
});

const COLUMNS: { status: TaskStatus; title: string }[] = [
  { status: "todo", title: "To Do" },
  { status: "in_progress", title: "In Progress" },
  { status: "done", title: "Done" },
];

function TasksPage() {
  useTasksStream();
  const { data, isLoading } = useTasks();
  const tasks = data?.tasks ?? [];

  const [activeTask, setActiveTask] = useState<TaskResponse | null>(null);
  const [overColumn, setOverColumn] = useState<TaskStatus | null>(null);
  const [dialogMode, setDialogMode] = useState<
    { type: "create"; status: TaskStatus } | { type: "edit"; task: TaskResponse } | null
  >(null);

  const reorderMutation = useReorderTasks();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function getColumnTasks(status: TaskStatus): TaskResponse[] {
    return tasks.filter((t) => t.status === status).sort((a, b) => a.order - b.order);
  }

  function handleDragStart(event: DragStartEvent) {
    const task = tasks.find((t) => t.id === event.active.id);
    setActiveTask(task ?? null);
  }

  function handleDragOver(event: DragOverEvent) {
    const { over } = event;
    if (!over) {
      setOverColumn(null);
      return;
    }

    const overId = String(over.id);
    const columnMatch = COLUMNS.find((c) => c.status === overId);
    if (columnMatch) {
      setOverColumn(columnMatch.status);
      return;
    }

    const overTask = tasks.find((t) => t.id === overId);
    if (overTask) {
      setOverColumn(overTask.status);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveTask(null);
    setOverColumn(null);

    if (!over) return;

    const draggedTask = tasks.find((t) => t.id === active.id);
    if (!draggedTask) return;

    const overId = String(over.id);
    const targetColumn = COLUMNS.find((c) => c.status === overId);
    const overTask = tasks.find((t) => t.id === overId);

    const targetStatus = targetColumn?.status ?? overTask?.status;
    if (!targetStatus) return;

    const columnTasks = getColumnTasks(targetStatus).filter((t) => t.id !== draggedTask.id);

    let insertIndex = columnTasks.length;
    if (overTask && overTask.id !== draggedTask.id) {
      insertIndex = columnTasks.findIndex((t) => t.id === overTask.id);
      if (insertIndex === -1) insertIndex = columnTasks.length;
    }

    const newOrder = [
      ...columnTasks.slice(0, insertIndex),
      draggedTask,
      ...columnTasks.slice(insertIndex),
    ];

    reorderMutation.mutate({
      taskIds: newOrder.map((t) => t.id),
      status: targetStatus,
    });
  }

  if (isLoading) {
    return (
      <div className="empty-state">
        <p>Loading tasks...</p>
      </div>
    );
  }

  return (
    <>
      <title>Tasks — Panopticon</title>
      <div className="flex flex-col gap-4">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {COLUMNS.map((col) => (
              <KanbanColumn
                key={col.status}
                status={col.status}
                title={col.title}
                tasks={getColumnTasks(col.status)}
                isOver={overColumn === col.status}
                onAddTask={() => setDialogMode({ type: "create", status: col.status })}
                onEditTask={(task) => setDialogMode({ type: "edit", task })}
              />
            ))}
          </div>
          <DragOverlay>{activeTask ? <TaskCard task={activeTask} isDragging /> : null}</DragOverlay>
        </DndContext>
      </div>
      {dialogMode && <TaskDialog mode={dialogMode} onClose={() => setDialogMode(null)} />}
    </>
  );
}

function KanbanColumn({
  status,
  title,
  tasks,
  isOver,
  onAddTask,
  onEditTask,
}: {
  status: TaskStatus;
  title: string;
  tasks: TaskResponse[];
  isOver: boolean;
  onAddTask: () => void;
  onEditTask: (task: TaskResponse) => void;
}) {
  const { setNodeRef } = useSortable({
    id: status,
    data: { type: "column" },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "bg-bg-secondary rounded-lg p-3 flex flex-col gap-2 min-h-[200px] border transition-colors",
        isOver ? "border-accent-blue" : "border-border-default",
      )}
    >
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wider">
          {title}
          <span className="ml-2 text-xs font-normal">({tasks.length})</span>
        </h2>
        <button
          type="button"
          onClick={onAddTask}
          className="text-text-muted hover:text-accent-blue transition-colors p-1 rounded"
          aria-label={`Add task to ${title}`}
        >
          <Plus size={16} />
        </button>
      </div>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2 flex-1">
          {tasks.map((task) => (
            <SortableTaskCard key={task.id} task={task} onEdit={() => onEditTask(task)} />
          ))}
          {tasks.length === 0 && (
            <div className="text-center text-text-muted text-xs py-8 opacity-60">No tasks</div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

function SortableTaskCard({ task, onEdit }: { task: TaskResponse; onEdit: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  const deleteMutation = useDeleteTask();

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    deleteMutation.mutate(task.id, {
      onSuccess: () => toast.success("Task deleted"),
      onError: () => toast.error("Failed to delete task"),
    });
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <TaskCard task={task} dragListeners={listeners} onEdit={onEdit} onDelete={handleDelete} />
    </div>
  );
}

function TaskCard({
  task,
  isDragging,
  dragListeners,
  onEdit,
  onDelete,
}: {
  task: TaskResponse;
  isDragging?: boolean;
  dragListeners?: Record<string, unknown>;
  onEdit?: () => void;
  onDelete?: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className={cn(
        "bg-bg-tertiary rounded-md p-3 border border-border-default",
        "hover:border-border-hover transition-colors group",
        isDragging && "shadow-lg ring-2 ring-accent-blue",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="text-text-muted hover:text-text-primary mt-0.5 cursor-grab active:cursor-grabbing shrink-0"
          aria-label="Drag to reorder"
          {...dragListeners}
        >
          <GripVertical size={14} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text-primary truncate">{task.title}</p>
          {task.description && (
            <p className="text-xs text-text-muted mt-1 line-clamp-2">{task.description}</p>
          )}
        </div>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="text-text-muted hover:text-accent-blue p-1 rounded"
              aria-label="Edit task"
            >
              <Pencil size={12} />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="text-text-muted hover:text-accent-red p-1 rounded"
              aria-label="Delete task"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TaskDialog({
  mode,
  onClose,
}: {
  mode: { type: "create"; status: TaskStatus } | { type: "edit"; task: TaskResponse };
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(mode.type === "edit" ? mode.task.title : "");
  const [description, setDescription] = useState(mode.type === "edit" ? mode.task.description : "");

  const createMutation = useCreateTask();
  const updateMutation = useUpdateTask();

  // Open dialog on mount
  const openRef = useRef(false);
  if (!openRef.current && dialogRef.current) {
    dialogRef.current.showModal();
    openRef.current = true;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    if (mode.type === "create") {
      createMutation.mutate(
        {
          title: title.trim(),
          description: description.trim() || undefined,
          status: mode.status,
        },
        {
          onSuccess: () => {
            toast.success("Task created");
            onClose();
          },
          onError: () => toast.error("Failed to create task"),
        },
      );
    } else {
      updateMutation.mutate(
        {
          id: mode.task.id,
          title: title.trim(),
          description: description.trim(),
        },
        {
          onSuccess: () => {
            toast.success("Task updated");
            onClose();
          },
          onError: () => toast.error("Failed to update task"),
        },
      );
    }
  }

  return (
    <dialog
      ref={(node) => {
        (dialogRef as React.MutableRefObject<HTMLDialogElement | null>).current = node;
        if (node && !openRef.current) {
          node.showModal();
          openRef.current = true;
        }
      }}
      onClose={onClose}
      className="bg-bg-secondary text-text-primary border border-border-default rounded-lg p-0 w-full max-w-md backdrop:bg-black/50"
    >
      <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
        <h2 className="text-lg font-semibold">
          {mode.type === "create" ? "Create Task" : "Edit Task"}
        </h2>
        <div className="flex flex-col gap-1">
          <label htmlFor="task-title" className="text-sm text-text-muted">
            Title
          </label>
          <input
            id="task-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title"
            className="bg-bg-tertiary border border-border-default rounded px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
            autoFocus
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="task-desc" className="text-sm text-text-muted">
            Description
          </label>
          <textarea
            id="task-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
            rows={3}
            className="bg-bg-tertiary border border-border-default rounded px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue resize-none"
          />
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-muted hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim()}
            className="px-4 py-2 text-sm bg-accent-blue text-white rounded hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {mode.type === "create" ? "Create" : "Save"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
