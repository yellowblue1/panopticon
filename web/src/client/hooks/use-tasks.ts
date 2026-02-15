import type { TaskStatus } from "@shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { taskKeys } from "@/lib/query-keys";
import { tasksApi } from "@/lib/rpc-client";

async function fetchTasks() {
  const res = await tasksApi.$get();
  return res.json();
}

export function useTasks() {
  return useQuery({
    queryKey: taskKeys.lists(),
    queryFn: fetchTasks,
    staleTime: 30_000,
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { title: string; description?: string; status?: TaskStatus }) => {
      const res = await tasksApi.$post({ json: input });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...input
    }: {
      id: string;
      title?: string;
      description?: string;
      status?: TaskStatus;
      order?: number;
    }) => {
      const res = await tasksApi[":id"].$put({
        param: { id },
        json: input,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await tasksApi[":id"].$delete({ param: { id } });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
  });
}

export function useReorderTasks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { taskIds: string[]; status: TaskStatus }) => {
      const res = await tasksApi.reorder.$put({ json: input });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
  });
}
