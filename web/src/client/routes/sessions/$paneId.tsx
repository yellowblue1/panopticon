import { createFileRoute, Link } from "@tanstack/react-router";
import { SendKeysInput } from "@/components/sessions/send-keys-input";
import { XtermViewer } from "@/components/sessions/xterm-viewer";
import { StatusBadge } from "@/components/ui/badge";
import { usePaneContent } from "@/hooks/use-pane-content";
import { useSessionsQuery } from "@/hooks/use-sessions";

export const Route = createFileRoute("/sessions/$paneId")({
  component: SessionDetailPage,
});

function SessionDetailPage() {
  const { paneId } = Route.useParams();
  const { data: paneData, isLoading, error } = usePaneContent(paneId);
  const { data: sessionsData } = useSessionsQuery();

  const session = sessionsData?.sessions.find((s) => s.pane_id === paneId);

  return (
    <>
      <title>{session?.project_name ?? paneId} - Panopticon</title>

      <div className="mb-4">
        <Link to="/" className="text-accent-blue hover:underline text-sm">
          &larr; Back to sessions
        </Link>
      </div>

      {session && (
        <div className="flex flex-wrap items-center gap-3 mb-4 text-sm">
          <span className="font-medium text-text-primary text-base">{session.project_name}</span>
          {session.git_branch && (
            <span className="font-mono text-accent-purple">{session.git_branch}</span>
          )}
          <StatusBadge variant={session.status} />
          <span className="text-text-muted">{paneId}</span>
        </div>
      )}

      {isLoading && (
        <div className="empty-state">
          <p>Loading pane content...</p>
        </div>
      )}

      {error && (
        <div className="empty-state">
          <p className="text-accent-red">Failed to load pane content</p>
          <p className="hint">{error.message}</p>
        </div>
      )}

      {!isLoading && !error && paneData?.content === null && (
        <div className="empty-state">
          <p>Pane not found</p>
          <p className="hint">The tmux pane {paneId} may have been closed.</p>
        </div>
      )}

      {paneData?.content != null && (
        <XtermViewer content={paneData.content} className="pane-viewer" />
      )}

      <SendKeysInput paneId={paneId} />
    </>
  );
}
