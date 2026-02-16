import type { AgentType, ProjectResponse } from "@shared/types";
import { Search } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ProjectCard } from "./project-card";

interface ProjectListProps {
  projects: ProjectResponse[];
  onLaunch: (project: ProjectResponse, agentType: AgentType) => void;
  isLaunching: boolean;
}

export function ProjectList({ projects, onLaunch, isLaunching }: ProjectListProps) {
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? projects.filter(
        (p) =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.path.toLowerCase().includes(search.toLowerCase()),
      )
    : projects;

  return (
    <div>
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search projects..."
          className={cn(
            "w-full bg-bg-secondary border border-border-default rounded-lg pl-9 pr-3 py-2",
            "text-sm text-text-primary placeholder:text-text-muted",
            "focus:outline-none focus:border-accent-blue transition-colors",
          )}
        />
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-8 text-text-muted text-sm">
          {projects.length === 0
            ? "No projects found. Configure scan paths above to discover projects."
            : "No projects match your search."}
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((project) => (
          <ProjectCard
            key={project.path}
            project={project}
            onLaunch={onLaunch}
            isLaunching={isLaunching}
          />
        ))}
      </div>
    </div>
  );
}
