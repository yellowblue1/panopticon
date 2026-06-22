import type { AgentDialect, AgentType, SlashCommand } from "@shared/types";

// Nori has no fixed dialect — it wraps either backend via `nori -a <agent>`
// at launch, and panopticon can't tell which from the process tree alone, so
// nori sessions fetch both dialects and the user picks the prefix.
export function dialectsForAgent(agentType: AgentType): readonly AgentDialect[] {
  if (agentType === "claude") return ["claude"];
  if (agentType === "codex") return ["codex"];
  return ["claude", "codex"];
}

// Returned in display order — `triggerKeys[0]` is what the action button shows.
export function triggerKeysForAgent(agentType: AgentType): readonly string[] {
  return dialectsForAgent(agentType).map((d) => (d === "codex" ? "$" : "/"));
}

export function mergeUniqueCommands(
  ...lists: readonly (readonly SlashCommand[])[]
): SlashCommand[] {
  const seen = new Set<string>();
  const merged: SlashCommand[] = [];
  for (const list of lists) {
    for (const cmd of list) {
      if (!seen.has(cmd.command)) {
        seen.add(cmd.command);
        merged.push(cmd);
      }
    }
  }
  return merged;
}
