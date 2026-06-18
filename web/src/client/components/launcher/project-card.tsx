import type { AgentType, ProjectResponse } from "@shared/types";
import { GitBranch, Play } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";

interface ProjectCardProps {
  project: ProjectResponse;
  onLaunch: (project: ProjectResponse, agentType: AgentType) => void;
  isLaunching: boolean;
}

export function ProjectCard({ project, onLaunch, isLaunching }: ProjectCardProps) {
  const [agentType, setAgentType] = useState<AgentType>("claude");

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg",
        "bg-bg-secondary border border-border-default",
        "hover:border-border-hover transition-colors",
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-text-primary truncate">{project.name}</div>
        <div className="text-xs text-text-muted font-mono truncate">{project.path}</div>
        {project.gitBranch && (
          <div className="flex items-center gap-1 mt-1 text-xs text-text-secondary">
            <GitBranch size={12} />
            <span className="truncate">{project.gitBranch}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <select
          value={agentType}
          onChange={(e) => setAgentType(e.target.value as AgentType)}
          className={cn(
            "bg-bg-primary border border-border-default rounded px-2 py-1.5",
            "text-xs text-text-primary",
            "focus:outline-none focus:border-accent-blue transition-colors",
          )}
        >
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
          <option value="nori">Nori</option>
        </select>

        <button
          type="button"
          onClick={() => onLaunch(project, agentType)}
          disabled={isLaunching}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium",
            "bg-accent-green text-white hover:opacity-90",
            "transition-opacity disabled:opacity-40 disabled:cursor-not-allowed",
          )}
        >
          <Play size={12} />
          Launch
        </button>
      </div>
    </div>
  );
}
