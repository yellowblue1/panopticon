import type { AgentType, ProjectResponse } from "@shared/types";
import { createFileRoute, Link } from "@tanstack/react-router";
import { LauncherConfig } from "@/components/launcher/launcher-config";
import { ProjectList } from "@/components/launcher/project-list";
import { useLaunchSession } from "@/hooks/use-launch-session";
import { useProjects } from "@/hooks/use-projects";

export const Route = createFileRoute("/launcher")({
  component: LauncherPage,
});

function LauncherPage() {
  const { data, isLoading } = useProjects();
  const launchMutation = useLaunchSession();

  const handleLaunch = (project: ProjectResponse, agentType: AgentType) => {
    launchMutation.mutate({
      projectPath: project.path,
      agentType,
    });
  };

  return (
    <>
      <title>Launcher - Panopticon</title>
      <div className="mb-4">
        <Link to="/" className="text-accent-blue hover:underline text-sm">
          &larr; Back to sessions
        </Link>
      </div>

      <div className="max-w-2xl">
        <h2 className="text-lg font-semibold text-text-primary mb-4">Session Launcher</h2>

        <LauncherConfig />

        {isLoading ? (
          <div className="text-center py-8 text-text-muted text-sm">Scanning projects...</div>
        ) : (
          <ProjectList
            projects={data && "projects" in data ? data.projects : []}
            onLaunch={handleLaunch}
            isLaunching={launchMutation.isPending}
          />
        )}
      </div>
    </>
  );
}
