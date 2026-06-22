import type { AgentDialect, AgentType, SlashCommand } from "@shared/types";

// Module-level constants so dialectsForAgent and triggerKeysForAgent return
// the same array identity for a given agentType. Stable refs let consumers
// use the returned arrays in React effect dependency lists without
// re-subscribing on every render.
const CLAUDE_DIALECTS: readonly AgentDialect[] = ["claude"];
const CODEX_DIALECTS: readonly AgentDialect[] = ["codex"];
const BOTH_DIALECTS: readonly AgentDialect[] = ["claude", "codex"];

const CLAUDE_KEYS: readonly string[] = ["/"];
const CODEX_KEYS: readonly string[] = ["$"];
const BOTH_KEYS: readonly string[] = ["/", "$"];

// Nori has no fixed dialect — it wraps either backend via `nori -a <agent>`
// at launch, and panopticon can't tell which from the process tree alone, so
// nori sessions fetch both dialects and the user picks the prefix.
export function dialectsForAgent(agentType: AgentType): readonly AgentDialect[] {
  if (agentType === "claude") return CLAUDE_DIALECTS;
  if (agentType === "codex") return CODEX_DIALECTS;
  return BOTH_DIALECTS;
}

// Returned in display order — `triggerKeys[0]` is what the action button shows.
export function triggerKeysForAgent(agentType: AgentType): readonly string[] {
  if (agentType === "claude") return CLAUDE_KEYS;
  if (agentType === "codex") return CODEX_KEYS;
  return BOTH_KEYS;
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
