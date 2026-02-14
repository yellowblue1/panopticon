import type { SlashCommand } from "./types";

export const DEFAULT_SLASH_COMMANDS: SlashCommand[] = [
  { command: "/clear", description: "Clear conversation history" },
  { command: "/compact", description: "Compact conversation with optional focus instructions" },
  { command: "/config", description: "Open the Settings interface (Config tab)" },
  { command: "/context", description: "Visualize current context usage as a colored grid" },
  { command: "/copy", description: "Copy the last assistant response to clipboard" },
  { command: "/cost", description: "Show token usage statistics" },
  {
    command: "/debug",
    description: "Troubleshoot the current session by reading the session debug log",
  },
  {
    command: "/desktop",
    description: "Hand off the current CLI session to the Claude Code Desktop app",
  },
  { command: "/doctor", description: "Checks the health of your Claude Code installation" },
  { command: "/exit", description: "Exit the REPL" },
  { command: "/export", description: "Export the current conversation to a file or clipboard" },
  { command: "/help", description: "Get usage help" },
  { command: "/init", description: "Initialize project with CLAUDE.md guide" },
  { command: "/mcp", description: "Manage MCP server connections and OAuth authentication" },
  { command: "/memory", description: "Edit CLAUDE.md memory files" },
  { command: "/model", description: "Select or change the AI model" },
  { command: "/permissions", description: "View or update permissions" },
  { command: "/plan", description: "Enter plan mode directly from the prompt" },
  { command: "/rename", description: "Rename the current session for easier identification" },
  {
    command: "/resume",
    description: "Resume a conversation by ID or name, or open the session picker",
  },
  { command: "/review", description: "Review a pull request" },
  {
    command: "/rewind",
    description: "Rewind the conversation and/or code, or summarize from a selected message",
  },
  {
    command: "/stats",
    description: "Visualize daily usage, session history, streaks, and model preferences",
  },
  { command: "/status", description: "Open the Settings interface (Status tab)" },
  { command: "/statusline", description: "Set up Claude Code's status line UI" },
  { command: "/tasks", description: "List and manage background tasks" },
  { command: "/teleport", description: "Resume a remote session from claude.ai" },
  { command: "/theme", description: "Change the color theme" },
  { command: "/todos", description: "List current TODO items" },
  { command: "/usage", description: "Show plan usage limits and rate limit status" },
];
