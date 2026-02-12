import { cva, type VariantProps } from "class-variance-authority";
import { Bot } from "lucide-react";
import { cn } from "@/lib/cn";

const agentIconVariants = cva("inline-flex items-center justify-center shrink-0", {
  variants: {
    agent: {
      claude: "text-[#e8926a]",
      codex: "text-accent-green",
      unknown: "text-text-muted",
    },
  },
  defaultVariants: {
    agent: "claude",
  },
});

type AgentVariant = NonNullable<VariantProps<typeof agentIconVariants>["agent"]>;

function ClaudeIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="w-full h-full">
      <path d="M8 0l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />
    </svg>
  );
}

function CodexIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
      className="w-full h-full"
    >
      <path d="M8 2.5 C11 3, 10.5 5, 9 6.3" />
      <path d="M12.8 5.3 C13.5 7, 11.5 8.5, 10 8" />
      <path d="M12.8 10.8 C12 12, 10 10.5, 9 9.7" />
      <path d="M8 13.5 C5 13, 5.5 11, 7 9.7" />
      <path d="M3.2 10.8 C2.5 9, 4.5 7.5, 6 8" />
      <path d="M3.2 5.3 C4 4, 6 5.5, 7 6.3" />
    </svg>
  );
}

const AGENT_CONFIG: Record<AgentVariant, { label: string; Icon: React.FC }> = {
  claude: { label: "Claude Code", Icon: ClaudeIcon },
  codex: { label: "Codex", Icon: CodexIcon },
  unknown: { label: "Unknown", Icon: () => <Bot size="100%" /> },
};

interface AgentTypeIconProps {
  agentType: string;
  className?: string;
}

export function AgentTypeIcon({ agentType, className }: AgentTypeIconProps) {
  const agent: AgentVariant =
    agentType === "codex" ? "codex" : agentType === "claude" ? "claude" : "unknown";
  const { label, Icon } = AGENT_CONFIG[agent];

  return (
    <span
      className={cn(agentIconVariants({ agent }), "w-4 h-4", className)}
      title={label}
      role="img"
      aria-label={label}
    >
      <Icon />
    </span>
  );
}
