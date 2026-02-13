import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { sessionsApi } from "@/lib/rpc-client";

interface SwitchClientInput {
  paneId: string;
}

export function useSwitchClient() {
  return useMutation({
    mutationFn: async ({ paneId }: SwitchClientInput) => {
      const res = await sessionsApi[":pane_id"].switch.$post({
        param: { pane_id: encodeURIComponent(paneId) },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to switch client");
      }
      return data;
    },
    onSuccess: () => {
      toast.success("Switched to session");
    },
    onError: (error: Error) => {
      toast.error(`Failed to switch: ${error.message}`);
    },
  });
}
