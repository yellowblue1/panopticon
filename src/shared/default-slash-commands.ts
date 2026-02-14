import type { SlashCommand } from "./types";

export const DEFAULT_SLASH_COMMANDS: SlashCommand[] = [
  { command: "/compact", description: "Compact conversation context" },
  { command: "/clear", description: "Clear conversation history" },
  { command: "/cost", description: "Show token usage and costs" },
  { command: "/doctor", description: "Check Claude Code health" },
  { command: "/help", description: "Show available commands" },
  { command: "/init", description: "Initialize CLAUDE.md in project" },
  { command: "/login", description: "Switch Anthropic accounts" },
  { command: "/logout", description: "Sign out from Anthropic" },
  { command: "/memory", description: "Edit CLAUDE.md memory files" },
  { command: "/model", description: "Switch AI model" },
  { command: "/permissions", description: "View or update tool permissions" },
  { command: "/review", description: "Review a pull request" },
];
