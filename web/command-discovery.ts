import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { SlashCommand } from "../src/shared/types";

function listMdFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".md"));
}

function toSlashCommand(
  name: string,
  source: "global" | "project" | "plugin",
  pluginName?: string,
): SlashCommand {
  if (source === "plugin" && pluginName) {
    return { command: `/${pluginName}:${name}`, description: `Plugin command (${pluginName})` };
  }
  return { command: `/${name}`, description: `Custom command (${source})` };
}

interface PluginEntry {
  installPath: string;
}

interface InstalledPlugins {
  plugins: Record<string, PluginEntry[]>;
}

function parsePluginName(key: string): string {
  const atIndex = key.indexOf("@");
  return atIndex === -1 ? key : key.slice(0, atIndex);
}

function isInstalledPlugins(value: unknown): value is InstalledPlugins {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.plugins !== "object" || obj.plugins === null) return false;
  return true;
}

/**
 * Discover slash commands from installed Claude Code plugins.
 *
 * Reads ~/.claude/plugins/installed_plugins.json and scans each plugin's
 * installPath + commands/ directory for .md files. Commands are namespaced
 * as /{pluginName}:{commandName}.
 */
export function discoverPluginCommands(homeDir?: string): SlashCommand[] {
  const home = homeDir ?? homedir();
  const pluginsFile = join(home, ".claude", "plugins", "installed_plugins.json");

  if (!existsSync(pluginsFile)) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(pluginsFile, "utf-8"));
  } catch {
    return [];
  }

  if (!isInstalledPlugins(parsed)) return [];

  const commands: SlashCommand[] = [];

  for (const [key, entries] of Object.entries(parsed.plugins)) {
    if (!Array.isArray(entries) || entries.length === 0) continue;
    const entry = entries[0];
    if (typeof entry?.installPath !== "string") continue;

    const pluginName = parsePluginName(key);
    const commandsDir = join(entry.installPath, "commands");

    for (const file of listMdFiles(commandsDir)) {
      const name = basename(file, ".md");
      commands.push(toSlashCommand(name, "plugin", pluginName));
    }
  }

  return commands.sort((a, b) => a.command.localeCompare(b.command));
}

/**
 * Discover slash commands by scanning .claude/commands/ directories.
 *
 * Scans both global (~/.claude/commands/) and project ({cwd}/.claude/commands/).
 * When both contain a command with the same name, the project version takes precedence.
 */
export function discoverSlashCommands(cwd: string, homeDir?: string): SlashCommand[] {
  const home = homeDir ?? homedir();

  const globalDir = join(home, ".claude", "commands");
  const projectDir = join(cwd, ".claude", "commands");

  const globalFiles = listMdFiles(globalDir);
  const projectFiles = listMdFiles(projectDir);

  const projectNames = new Set(projectFiles.map((f) => basename(f, ".md")));

  const commands: SlashCommand[] = [];

  for (const file of globalFiles) {
    const name = basename(file, ".md");
    if (!projectNames.has(name)) {
      commands.push(toSlashCommand(name, "global"));
    }
  }

  for (const file of projectFiles) {
    const name = basename(file, ".md");
    commands.push(toSlashCommand(name, "project"));
  }

  return commands.sort((a, b) => a.command.localeCompare(b.command));
}

/**
 * Discover slash commands across multiple session CWDs.
 *
 * Scans ~/.claude/commands/ (global, lowest priority) and each CWD's
 * .claude/commands/ (project, higher priority). When the same command
 * name appears in multiple locations, project commands win over global,
 * and the first CWD wins over later CWDs.
 */
export function discoverAllSlashCommands(cwds: string[], homeDir?: string): SlashCommand[] {
  const home = homeDir ?? homedir();
  const globalDir = join(home, ".claude", "commands");

  const seen = new Map<string, SlashCommand>();

  for (const cwd of cwds) {
    const projectDir = join(cwd, ".claude", "commands");
    for (const file of listMdFiles(projectDir)) {
      const name = basename(file, ".md");
      if (!seen.has(name)) {
        seen.set(name, toSlashCommand(name, "project"));
      }
    }
  }

  for (const file of listMdFiles(globalDir)) {
    const name = basename(file, ".md");
    if (!seen.has(name)) {
      seen.set(name, toSlashCommand(name, "global"));
    }
  }

  for (const cmd of discoverPluginCommands(home)) {
    const name = cmd.command.slice(1);
    if (!seen.has(name)) {
      seen.set(name, cmd);
    }
  }

  return [...seen.values()].sort((a, b) => a.command.localeCompare(b.command));
}
