import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { sessionsApi } from "@/lib/rpc-client";

interface SendKeysInput {
  paneId: string;
  text: string;
  /** When true, sends text as a raw tmux key name (no literal mode, no Enter). */
  raw?: boolean;
}

export function useSendKeys() {
  return useMutation({
    mutationFn: async ({ paneId, text, raw }: SendKeysInput) => {
      const res = await sessionsApi[":pane_id"]["send-keys"].$post({
        param: { pane_id: encodeURIComponent(paneId) },
        json: { text, ...(raw ? { raw: true } : {}) },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to send keys");
      }
      return data;
    },
    onError: (error: Error) => {
      toast.error(`Failed to send: ${error.message}`);
    },
  });
}
