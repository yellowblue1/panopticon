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
      <path
        fillRule="evenodd"
        d="M2 2.5A1.5 1.5 0 013.5 1h9A1.5 1.5 0 0114 2.5v11a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 13.5v-11zm2.75 3.75a.75.75 0 000 1.06L6.44 9 4.75 10.69a.75.75 0 101.06 1.06l2.22-2.22a.75.75 0 000-1.06L5.81 6.25a.75.75 0 00-1.06 0zM8.5 11.25a.75.75 0 000 1.5h3a.75.75 0 000-1.5h-3z"
      />
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
