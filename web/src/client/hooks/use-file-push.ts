import type { FilePushSseEvent } from "@shared/types";
import { useRef } from "react";
import { toast } from "sonner";
import { formatFileSize } from "@/lib/format-file-size";

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function useFilePush(): {
  handleFilePush: (event: FilePushSseEvent, blob: Blob) => void;
} {
  const handledRef = useRef(new Set<string>());

  const handleFilePush = (event: FilePushSseEvent, blob: Blob) => {
    const key = `${event.timestamp}-${event.filename}`;
    if (handledRef.current.has(key)) return;
    handledRef.current.add(key);

    if (handledRef.current.size > 100) {
      const entries = [...handledRef.current];
      handledRef.current = new Set(entries.slice(-50));
    }

    const objectUrl = URL.createObjectURL(blob);
    let downloaded = false;

    const revokeIfNeeded = () => {
      if (!downloaded) URL.revokeObjectURL(objectUrl);
    };

    const description = event.mimeType.startsWith("image/")
      ? "Click to download"
      : `${event.mimeType} — ${formatFileSize(event.size)}`;

    toast(`File received: ${event.filename}`, {
      description,
      duration: 10000,
      action: {
        label: "Download",
        onClick: () => {
          downloaded = true;
          triggerDownload(objectUrl, event.filename);
        },
      },
      onDismiss: revokeIfNeeded,
      onAutoClose: revokeIfNeeded,
    });
  };

  return { handleFilePush };
}
