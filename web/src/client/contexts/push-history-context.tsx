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

interface PushHistoryDispatch {
  addFilePush: (event: FilePushSseEvent, blob: Blob) => void;
  addUrlPush: (event: UrlPushSseEvent) => void;
}

const EntriesContext = createContext<PushHistoryEntry[] | null>(null);
const DispatchContext = createContext<PushHistoryDispatch | null>(null);

export function prependCapped(
  entries: PushHistoryEntry[],
  entry: PushHistoryEntry,
): PushHistoryEntry[] {
  return [entry, ...entries].slice(0, MAX_PUSH_HISTORY_ENTRIES);
}

export function PushHistoryProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<PushHistoryEntry[]>([]);

  // Stable dispatch object — created once so AppShell (which only reads dispatch)
  // doesn't re-render when entries change.
  const [dispatch] = useState<PushHistoryDispatch>(() => ({
    addFilePush: (event, blob) => {
      setEntries((current) => {
        const id = `${event.timestamp}-${event.sessionId ?? ""}-${event.filename}`;
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
    },
    addUrlPush: (event) => {
      setEntries((current) => {
        const id = `${event.timestamp}-${event.sessionId ?? ""}-${event.url}`;
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
    },
  }));

  return (
    <DispatchContext.Provider value={dispatch}>
      <EntriesContext.Provider value={entries}>{children}</EntriesContext.Provider>
    </DispatchContext.Provider>
  );
}

export function usePushHistoryEntries(): PushHistoryEntry[] {
  const entries = useContext(EntriesContext);
  if (entries === null) {
    throw new Error("usePushHistoryEntries must be used within a PushHistoryProvider");
  }
  return entries;
}

export function usePushHistoryDispatch(): PushHistoryDispatch {
  const dispatch = useContext(DispatchContext);
  if (dispatch === null) {
    throw new Error("usePushHistoryDispatch must be used within a PushHistoryProvider");
  }
  return dispatch;
}
