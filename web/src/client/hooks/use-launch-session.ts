import type { AgentType } from "@shared/types";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { launcherApi } from "@/lib/rpc-client";

export function useLaunchSession() {
  return useMutation({
    mutationFn: async (input: {
      projectPath: string;
      agentType: AgentType;
      sessionName?: string;
    }) => {
      const res = await launcherApi.launch.$post({
        json: input,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          "error" in data && typeof data.error === "string"
            ? data.error
            : "Failed to launch session",
        );
      }
      return data;
    },
    onSuccess: (data) => {
      if ("sessionName" in data) {
        toast.success(`Launched session: ${data.sessionName}`);
      }
    },
    onError: (error: Error) => {
      toast.error(`Launch failed: ${error.message}`);
    },
  });
}
