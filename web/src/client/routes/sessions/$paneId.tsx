import { createFileRoute, Link } from "@tanstack/react-router";
import { FileText, Inbox, SquareTerminal } from "lucide-react";
import { useEffect, useState } from "react";
import { PlanViewer } from "@/components/sessions/plan-viewer";
import { PushHistoryViewer } from "@/components/sessions/push-history-viewer";
import { SendKeysInput } from "@/components/sessions/send-keys-input";
import { SessionTabs } from "@/components/sessions/session-tabs";
import { TerminalViewer } from "@/components/sessions/terminal-viewer";
import { StatusBadge } from "@/components/ui/badge";
import { useDeletePlan } from "@/hooks/use-delete-plan";
import { usePaneContent } from "@/hooks/use-pane-content";
import { usePlan } from "@/hooks/use-plan";
import { useReadStatus } from "@/hooks/use-read-status";
import { useSessionsQuery } from "@/hooks/use-sessions";
import { cn } from "@/lib/cn";

type TabId = "terminal" | "plan" | "pushes";

export const Route = createFileRoute("/sessions/$paneId")({
  component: SessionDetailPage,
  validateSearch: (search: Record<string, unknown>): { tab?: TabId } => ({
    tab:
      search.tab === "terminal" || search.tab === "plan" || search.tab === "pushes"
        ? search.tab
        : undefined,
  }),
});

function SessionDetailPage() {
  const { paneId } = Route.useParams();
  const { tab: initialTab } = Route.useSearch();
  const [activeTab, setActiveTab] = useState<TabId>(initialTab ?? "terminal");
  const [isExpanded, setIsExpanded] = useState(false);

  const { data: paneData, isLoading: paneLoading, error: paneError } = usePaneContent(paneId);
  const { data: planData } = usePlan(paneId);
  const { data: sessionsData } = useSessionsQuery();
  const deletePlanMutation = useDeletePlan();

  const session = sessionsData?.sessions.find((s) => s.pane_id === paneId);
  const hasPlan = planData?.plan != null;
  const paneIdArray = [paneId];
  const { markAsRead } = useReadStatus(paneIdArray);

  // Mark session as read when detail page is opened
  useEffect(() => {
    markAsRead(paneId);
  }, [paneId, markAsRead]);

  const tabs = [
    { id: "terminal" as const, label: "Terminal", icon: <SquareTerminal size={16} /> },
    ...(hasPlan ? [{ id: "plan" as const, label: "Plan", icon: <FileText size={16} /> }] : []),
    { id: "pushes" as const, label: "Pushes", icon: <Inbox size={16} /> },
  ];

  // Derive effective tab: fall back to terminal when plan is unavailable
  const effectiveTab: TabId = activeTab === "plan" && !hasPlan ? "terminal" : activeTab;

  // Toggle vertical-expand class on <html> to hide root header via CSS
  useEffect(() => {
    document.documentElement.classList.toggle("vertical-expand", isExpanded);
    return () => document.documentElement.classList.remove("vertical-expand");
  }, [isExpanded]);

  // Exit expanded mode on Escape key (unless focus is in a text input or textarea)
  useEffect(() => {
    if (!isExpanded) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        setIsExpanded(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isExpanded]);

  return (
    <>
      <title>{session?.project_name ?? paneId} - Panopticon</title>

      {/* Header elements — hidden in expanded mode */}
      {!isExpanded && (
        <>
          <div className="mb-4">
            <Link to="/" className="text-accent-blue hover:underline text-sm">
              &larr; Back to sessions
            </Link>
          </div>

          {session && (
            <div className="flex flex-wrap items-center gap-3 mb-4 text-sm">
              <span className="font-medium text-text-primary text-base">
                {session.project_name}
              </span>
              {session.window_name && (
                <span className="font-mono text-accent-purple">{session.window_name}</span>
              )}
              <StatusBadge variant={session.status} />
              <span className="text-text-muted">{paneId}</span>
            </div>
          )}

          <SessionTabs
            tabs={tabs}
            activeTab={effectiveTab}
            onTabChange={(id) => setActiveTab(id as TabId)}
          />
        </>
      )}

      {/* Terminal content */}
      {effectiveTab === "terminal" && (
        <div className="flex-1 flex flex-col">
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
            <TerminalViewer
              content={paneData.content}
              className={cn("pane-viewer", isExpanded && "pane-viewer--expanded")}
              isExpanded={isExpanded}
              onExpandToggle={() => setIsExpanded((prev) => !prev)}
              githubRepoUrl={session?.github_repo_url}
            />
          )}

          <SendKeysInput paneId={paneId} agentType={session?.agent_type ?? "claude"} />
        </div>
      )}

      {effectiveTab === "plan" && !isExpanded && hasPlan && planData?.plan && (
        <PlanViewer
          content={planData.plan.content}
          slug={planData.plan.slug}
          onDelete={() => deletePlanMutation.mutate({ paneId })}
          isDeleting={deletePlanMutation.isPending}
        />
      )}

      {effectiveTab === "pushes" && !isExpanded && <PushHistoryViewer paneId={paneId} />}
    </>
  );
}
