import type { FilePushSseEvent, UrlPushSseEvent } from "@shared/types";
import { createContext, type ReactNode, useContext, useState } from "react";

export const MAX_PUSH_HISTORY_ENTRIES = 200;

export type PushHistoryEntry =
  | {
      kind: "file";
      id: string;
      timestamp: number;
      sessionId: string | null;
      filename: string;
      mimeType: string;
      size: number;
      blob: Blob;
    }
  | {
      kind: "url";
      id: string;
      timestamp: number;
      sessionId: string | null;
      url: string;
      label: string | null;
    };

interface PushHistoryContextValue {
  entries: PushHistoryEntry[];
  addFilePush: (event: FilePushSseEvent, blob: Blob) => void;
  addUrlPush: (event: UrlPushSseEvent) => void;
}

const PushHistoryContext = createContext<PushHistoryContextValue | null>(null);

export function prependCapped(
  entries: PushHistoryEntry[],
  entry: PushHistoryEntry,
): PushHistoryEntry[] {
  const next = [entry, ...entries];
  return next.length > MAX_PUSH_HISTORY_ENTRIES ? next.slice(0, MAX_PUSH_HISTORY_ENTRIES) : next;
}

export function PushHistoryProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<PushHistoryEntry[]>([]);

  const addFilePush = (event: FilePushSseEvent, blob: Blob) => {
    setEntries((current) => {
      const id = `${event.timestamp}-${event.filename}`;
      if (current.some((e) => e.id === id)) return current;
      return prependCapped(current, {
        kind: "file",
        id,
        timestamp: event.timestamp,
        sessionId: event.sessionId,
        filename: event.filename,
        mimeType: event.mimeType,
        size: event.size,
        blob,
      });
    });
  };

  const addUrlPush = (event: UrlPushSseEvent) => {
    setEntries((current) => {
      const id = `${event.timestamp}-${event.url}`;
      if (current.some((e) => e.id === id)) return current;
      return prependCapped(current, {
        kind: "url",
        id,
        timestamp: event.timestamp,
        sessionId: event.sessionId,
        url: event.url,
        label: event.label,
      });
    });
  };

  return (
    <PushHistoryContext.Provider value={{ entries, addFilePush, addUrlPush }}>
      {children}
    </PushHistoryContext.Provider>
  );
}

export function usePushHistory(): PushHistoryContextValue {
  const context = useContext(PushHistoryContext);
  if (!context) {
    throw new Error("usePushHistory must be used within a PushHistoryProvider");
  }
  return context;
}
