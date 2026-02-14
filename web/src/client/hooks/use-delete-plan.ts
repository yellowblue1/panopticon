import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { planKeys } from "@/lib/query-keys";
import { sessionsApi } from "@/lib/rpc-client";

interface DeletePlanInput {
  paneId: string;
}

export function useDeletePlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ paneId }: DeletePlanInput) => {
      const res = await sessionsApi[":pane_id"].plan.$delete({
        param: { pane_id: encodeURIComponent(paneId) },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to delete plan");
      }
      return data;
    },
    onSuccess: (_data, { paneId }) => {
      queryClient.invalidateQueries({ queryKey: planKeys.detail(paneId) });
      queryClient.invalidateQueries({ queryKey: planKeys.availability() });
      toast.success("Plan deleted");
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete plan: ${error.message}`);
    },
  });
}
