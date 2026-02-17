import type { SendMessageResponse } from "@shared/types";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

interface SendMessageInput {
  paneId: string;
  text: string;
  files: File[];
}

export function useSendMessage() {
  return useMutation({
    mutationFn: async ({ paneId, text, files }: SendMessageInput) => {
      const formData = new FormData();
      formData.append("text", text);
      for (const file of files) {
        formData.append("files", file);
      }

      const res = await fetch(`/api/sessions/${encodeURIComponent(paneId)}/send-message`, {
        method: "POST",
        body: formData,
      });

      const data: SendMessageResponse = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to send message");
      }
      return data;
    },
    onError: (error: Error) => {
      toast.error(`Failed to send: ${error.message}`);
    },
  });
}
