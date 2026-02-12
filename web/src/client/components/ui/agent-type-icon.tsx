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
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="w-full h-full">
      <path d="M8 6.2L8 2.5 10.4 3.9ZM9.6 7.1L12.8 5.3 12.8 8ZM9.6 8.9L12.8 10.8 10.4 12.1ZM8 9.8L8 13.5 5.6 12.1ZM6.4 8.9L3.2 10.8 3.2 8ZM6.4 7.1L3.2 5.3 5.6 3.9Z" />
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
