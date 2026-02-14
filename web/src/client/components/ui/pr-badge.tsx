import type { PullRequestInfo } from "@shared/types";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/cn";

interface PrBadgeProps {
  pr: PullRequestInfo;
  className?: string;
}

const stateStyles: Record<PullRequestInfo["state"], string> = {
  open: "text-accent-green",
  draft: "text-text-muted",
  merged: "text-accent-purple",
  closed: "text-accent-red",
};

export function PrBadge({ pr, className }: PrBadgeProps) {
  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noopener noreferrer"
      title={`#${pr.number}: ${pr.title} (${pr.state})`}
      className={cn("pr-badge", stateStyles[pr.state], className)}
    >
      #{pr.number}
      <ExternalLink size={12} />
    </a>
  );
}
