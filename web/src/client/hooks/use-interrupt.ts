import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { sessionsApi } from "@/lib/rpc-client";

type InterruptInput = {
  paneId: string;
};

export function useInterrupt() {
  return useMutation({
    mutationFn: async ({ paneId }: InterruptInput) => {
      const res = await sessionsApi[":pane_id"].interrupt.$post({
        param: { pane_id: encodeURIComponent(paneId) },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to send interrupt");
      }
      return data;
    },
    onError: (error: Error) => {
      toast.error(`Failed to interrupt: ${error.message}`);
    },
  });
}
