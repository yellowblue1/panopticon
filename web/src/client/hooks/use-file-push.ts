import type { FilePushSseEvent } from "@shared/types";
import { useRef } from "react";
import { toast } from "sonner";

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export function useFilePush(): {
  handleFilePush: (event: FilePushSseEvent) => void;
} {
  const handledRef = useRef(new Set<string>());

  const handleFilePush = (event: FilePushSseEvent) => {
    // Deduplicate by timestamp + filename
    const key = `${event.timestamp}-${event.filename}`;
    if (handledRef.current.has(key)) return;
    handledRef.current.add(key);

    // Keep the set from growing unbounded
    if (handledRef.current.size > 100) {
      const entries = [...handledRef.current];
      handledRef.current = new Set(entries.slice(-50));
    }

    const blob = base64ToBlob(event.base64, event.mimeType);
    const objectUrl = URL.createObjectURL(blob);

    const isImage = event.mimeType.startsWith("image/");

    if (isImage) {
      toast(`File received: ${event.filename}`, {
        description: "Click to download",
        duration: 10000,
        action: {
          label: "Download",
          onClick: () => triggerDownload(objectUrl, event.filename),
        },
      });
    } else {
      toast(`File received: ${event.filename}`, {
        description: `${event.mimeType} — ${formatFileSize(event.size)}`,
        duration: 10000,
        action: {
          label: "Download",
          onClick: () => triggerDownload(objectUrl, event.filename),
        },
      });
    }
  };

  return { handleFilePush };
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
