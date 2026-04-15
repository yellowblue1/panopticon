import type { UrlPushSseEvent } from "@shared/types";
import { useRef } from "react";
import { toast } from "sonner";

export function useUrlPush(): {
  handleUrlPush: (event: UrlPushSseEvent) => void;
} {
  const handledRef = useRef(new Set<string>());

  const handleUrlPush = (event: UrlPushSseEvent) => {
    const key = `${event.timestamp}-${event.url}`;
    if (handledRef.current.has(key)) return;
    handledRef.current.add(key);

    if (handledRef.current.size > 100) {
      const entries = [...handledRef.current];
      handledRef.current = new Set(entries.slice(-50));
    }

    const label = event.label ?? event.url;

    toast(`URL received: ${label}`, {
      description: event.url,
      duration: 15000,
      action: {
        label: "Open",
        onClick: () => {
          window.open(event.url, "_blank", "noopener,noreferrer");
        },
      },
    });
  };

  return { handleUrlPush };
}
