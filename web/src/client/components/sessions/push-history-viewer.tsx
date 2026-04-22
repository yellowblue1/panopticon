import { ExternalLink, FileDown, Inbox } from "lucide-react";
import { type PushHistoryEntry, usePushHistory } from "@/contexts/push-history-context";
import { cn } from "@/lib/cn";
import { formatFileSize } from "@/lib/format-file-size";
import { formatRelativeTime } from "@/lib/format-relative-time";

interface PushHistoryViewerProps {
  paneId: string;
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function isVisibleForPane(entry: PushHistoryEntry, paneId: string): boolean {
  return entry.sessionId === null || entry.sessionId === paneId;
}

export function PushHistoryViewer({ paneId }: PushHistoryViewerProps) {
  const { entries } = usePushHistory();
  const visible = entries.filter((e) => isVisibleForPane(e, paneId));

  if (visible.length === 0) {
    return (
      <div className="empty-state">
        <Inbox size={32} className="mx-auto mb-2 text-text-muted" />
        <p>No pushes yet</p>
        <p className="hint">
          Files and URLs delivered via <code>push_file</code> / <code>push_url</code> will appear
          here.
        </p>
      </div>
    );
  }

  return (
    <ul className="push-history-list flex flex-col gap-2">
      {visible.map((entry) => (
        <li
          key={entry.id}
          className={cn(
            "push-history-item",
            "flex items-center gap-3 p-3 rounded",
            "bg-bg-secondary border border-border-default",
          )}
        >
          <div className="shrink-0 text-text-muted">
            {entry.kind === "file" ? <FileDown size={18} /> : <ExternalLink size={18} />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="truncate font-medium text-text-primary">
              {entry.kind === "file" ? entry.filename : (entry.label ?? entry.url)}
            </div>
            <div className="truncate text-xs text-text-muted">
              {entry.kind === "file"
                ? `${entry.mimeType} — ${formatFileSize(entry.size)}`
                : entry.url}
            </div>
          </div>
          <div
            className="shrink-0 text-xs text-text-muted"
            title={new Date(entry.timestamp).toLocaleString()}
          >
            {formatRelativeTime(entry.timestamp)}
          </div>
          <div className="shrink-0">
            {entry.kind === "file" ? (
              <button
                type="button"
                onClick={() => triggerBlobDownload(entry.blob, entry.filename)}
                className={cn(
                  "text-xs px-3 py-1.5 rounded",
                  "bg-bg-tertiary text-text-primary hover:bg-border-default",
                  "transition-colors",
                )}
              >
                Download
              </button>
            ) : (
              <a
                href={entry.url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "text-xs px-3 py-1.5 rounded inline-block",
                  "bg-bg-tertiary text-text-primary hover:bg-border-default",
                  "transition-colors no-underline",
                )}
              >
                Open
              </a>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
