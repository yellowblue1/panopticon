import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { SessionTable } from "@/components/sessions/session-table";
import { WarningBanner } from "@/components/ui/warning-banner";
import { useAuthStatus } from "@/hooks/use-auth-status";
import { useSessionsQuery } from "@/hooks/use-sessions";
import { useSessionsStream } from "@/hooks/use-sessions-stream";
import { requestNotificationPermission } from "@/lib/notifications";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

function DashboardPage() {
  const { data: authStatus } = useAuthStatus();
  const { data: sessionsData } = useSessionsQuery();

  // Establish SSE connection for real-time updates
  useSessionsStream();

  // Request notification permission on mount
  useEffect(() => {
    requestNotificationPermission();
  }, []);

  const sessions = sessionsData?.sessions ?? [];

  return (
    <>
      <title>Claude Monitoring</title>
      <WarningBanner authStatus={authStatus} />
      <SessionTable sessions={sessions} />
    </>
  );
}
