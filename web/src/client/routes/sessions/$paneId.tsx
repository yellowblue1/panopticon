import { createFileRoute, Link } from "@tanstack/react-router";
import { FileText, SquareTerminal } from "lucide-react";
import { useState } from "react";
import { PlanViewer } from "@/components/sessions/plan-viewer";
import { SendKeysInput } from "@/components/sessions/send-keys-input";
import { SessionTabs } from "@/components/sessions/session-tabs";
import { XtermViewer } from "@/components/sessions/xterm-viewer";
import { StatusBadge } from "@/components/ui/badge";
import { usePaneContent } from "@/hooks/use-pane-content";
import { usePlan } from "@/hooks/use-plan";
import { useSessionsQuery } from "@/hooks/use-sessions";

type TabId = "terminal" | "plan";

export const Route = createFileRoute("/sessions/$paneId")({
  component: SessionDetailPage,
  validateSearch: (search: Record<string, unknown>) => ({
    tab: search.tab === "terminal" || search.tab === "plan" ? search.tab : undefined,
  }),
});

function SessionDetailPage() {
  const { paneId } = Route.useParams();
  const { tab: initialTab } = Route.useSearch();
  const [activeTab, setActiveTab] = useState<TabId>(initialTab ?? "terminal");

  const { data: paneData, isLoading: paneLoading, error: paneError } = usePaneContent(paneId);
  const { data: planData } = usePlan(paneId);
  const { data: sessionsData } = useSessionsQuery();

  const session = sessionsData?.sessions.find((s) => s.pane_id === paneId);
  const hasPlan = planData?.plan != null;

  const tabs = [
    { id: "terminal" as const, label: "Terminal", icon: <SquareTerminal size={16} /> },
    ...(hasPlan ? [{ id: "plan" as const, label: "Plan", icon: <FileText size={16} /> }] : []),
  ];

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

      {hasPlan && (
        <SessionTabs
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as TabId)}
        />
      )}

      {activeTab === "terminal" && (
        <>
          {paneLoading && (
            <div className="empty-state">
              <p>Loading pane content...</p>
            </div>
          )}

          {paneError && (
            <div className="empty-state">
              <p className="text-accent-red">Failed to load pane content</p>
              <p className="hint">{paneError.message}</p>
            </div>
          )}

          {!paneLoading && !paneError && paneData?.content === null && (
            <div className="empty-state">
              <p>Pane not found</p>
              <p className="hint">The tmux pane {paneId} may have been closed.</p>
            </div>
          )}

          {paneData?.content != null && (
            <XtermViewer content={paneData.content} className="pane-viewer" />
          )}
        </>
      )}

      {activeTab === "plan" && hasPlan && planData?.plan && (
        <PlanViewer content={planData.plan.content} slug={planData.plan.slug} />
      )}

      {activeTab === "terminal" && <SendKeysInput paneId={paneId} />}
    </>
  );
}
