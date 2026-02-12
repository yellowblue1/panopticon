import type { SendKeysResponse } from "@shared/types";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

interface SendKeysInput {
  paneId: string;
  text: string;
  /** When true, sends text as a raw tmux key name (no literal mode, no Enter). */
  raw?: boolean;
}

export function useSendKeys() {
  return useMutation({
    mutationFn: async ({ paneId, text, raw }: SendKeysInput) => {
      const res = await fetch(`/api/sessions/${encodeURIComponent(paneId)}/send-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, ...(raw ? { raw: true } : {}) }),
      });

      const data = (await res.json()) as SendKeysResponse;
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
