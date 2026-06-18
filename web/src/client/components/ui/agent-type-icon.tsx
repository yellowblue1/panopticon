import { cva, type VariantProps } from "class-variance-authority";
import { Bot } from "lucide-react";
import { cn } from "@/lib/cn";

const agentIconVariants = cva("inline-flex items-center justify-center shrink-0", {
  variants: {
    agent: {
      claude: "text-[#e8926a]",
      codex: "text-white",
      nori: "text-[#2e7d32]",
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
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
      className="w-full h-full"
    >
      <g transform="translate(8,8)">
        <path d="M0,-1 C0.3,-3 -0.3,-5 0.2,-6.8" />
        <path d="M0.7,-0.7 C2.2,-2.2 3.5,-4 5,-5.2" />
        <path d="M1,-0.2 C3.2,-0.8 5,0.2 6.5,-0.5" />
        <path d="M0.7,0.7 C2.5,1.8 3.8,3.5 5.2,5" />
        <path d="M0,1 C-0.4,3.2 0.3,5 -0.2,6.5" />
        <path d="M-0.7,0.7 C-2,2.5 -3.8,3.8 -5.4,4.8" />
        <path d="M-1,0.2 C-3,0.6 -4.8,-0.3 -6.2,0.3" />
        <path d="M-0.7,-0.7 C-2.4,-2 -4,-3.6 -5,-5.4" />
      </g>
      <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CodexIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="w-full h-full">
      <path d="M14.949 6.547a3.94 3.94 0 0 0-.348-3.273 4.11 4.11 0 0 0-4.4-1.934A4.1 4.1 0 0 0 8.423.2 4.15 4.15 0 0 0 6.305.086a4.1 4.1 0 0 0-1.891.948 4.04 4.04 0 0 0-1.158 1.753 4.1 4.1 0 0 0-1.563.679A4 4 0 0 0 .554 4.72a3.99 3.99 0 0 0 .502 4.731 3.94 3.94 0 0 0 .346 3.274 4.11 4.11 0 0 0 4.402 1.933c.382.425.852.764 1.377.995.526.231 1.095.35 1.67.346 1.78.002 3.358-1.132 3.901-2.804a4.1 4.1 0 0 0 1.563-.68 4 4 0 0 0 1.14-1.253 3.99 3.99 0 0 0-.506-4.716m-6.097 8.406a3.05 3.05 0 0 1-1.945-.694l.096-.054 3.23-1.838a.53.53 0 0 0 .265-.455v-4.49l1.366.778q.02.011.025.035v3.722c-.003 1.653-1.361 2.992-3.037 2.996m-6.53-2.75a2.95 2.95 0 0 1-.36-2.01l.095.057L5.29 12.09a.53.53 0 0 0 .527 0l3.949-2.246v1.555a.05.05 0 0 1-.022.041L6.473 13.3c-1.454.826-3.311.335-4.15-1.098m-.85-6.94A3.02 3.02 0 0 1 3.07 3.949v3.785a.51.51 0 0 0 .262.451l3.93 2.237-1.366.779a.05.05 0 0 1-.048 0L2.585 9.342a2.98 2.98 0 0 1-1.113-4.094zm11.216 2.571L8.747 5.576l1.362-.776a.05.05 0 0 1 .048 0l3.265 1.86a3 3 0 0 1 1.173 1.207 2.96 2.96 0 0 1-.27 3.2 3.05 3.05 0 0 1-1.36.997V8.279a.52.52 0 0 0-.276-.445m1.36-2.015-.097-.057-3.226-1.855a.53.53 0 0 0-.53 0L6.249 6.153V4.598a.04.04 0 0 1 .019-.04L9.533 2.7a3.07 3.07 0 0 1 3.257.139c.474.325.843.778 1.066 1.303.223.526.289 1.103.191 1.664zM5.503 8.575 4.139 7.8a.05.05 0 0 1-.026-.037V4.049c0-.57.166-1.127.476-1.607s.752-.864 1.275-1.105a3.08 3.08 0 0 1 3.234.41l-.096.054-3.23 1.838a.53.53 0 0 0-.265.455zm.742-1.577 1.758-1 1.762 1v2l-1.755 1-1.762-1z" />
    </svg>
  );
}

function NoriIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="w-full h-full">
      <rect x="1" y="3" width="14" height="10" rx="1.5" />
      <rect x="3" y="5" width="10" height="6" rx="0.5" fill="#f5f5dc" />
    </svg>
  );
}

const AGENT_CONFIG: Record<AgentVariant, { label: string; Icon: React.FC }> = {
  claude: { label: "Claude Code", Icon: ClaudeIcon },
  codex: { label: "Codex", Icon: CodexIcon },
  nori: { label: "Nori", Icon: NoriIcon },
  unknown: { label: "Unknown", Icon: () => <Bot size="100%" /> },
};

function isAgentVariant(value: string): value is AgentVariant {
  // Object.hasOwn — `in` would match inherited Object.prototype keys like
  // "toString" or "constructor", which would then hit `AGENT_CONFIG[key]` and
  // return undefined, crashing the icon render.
  return Object.hasOwn(AGENT_CONFIG, value);
}

interface AgentTypeIconProps {
  agentType: string;
  className?: string;
}

export function AgentTypeIcon({ agentType, className }: AgentTypeIconProps) {
  const agent: AgentVariant = isAgentVariant(agentType) ? agentType : "unknown";
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
