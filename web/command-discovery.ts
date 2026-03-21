import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { SlashCommand } from "../src/shared/types";

function listMdFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".md"));
}

function listSubdirectories(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  const lines = match[1].split("\n");

  let currentKey = "";
  let multilineValue = "";
  let inMultiline = false;

  const flushMultiline = () => {
    if (currentKey) {
      result[currentKey] = multilineValue.replace(/\s+/g, " ").trim();
    }
    currentKey = "";
    multilineValue = "";
    inMultiline = false;
  };

  for (const line of lines) {
    if (inMultiline) {
      if (/^\s/.test(line)) {
        multilineValue += ` ${line.trim()}`;
        continue;
      }
      flushMultiline();
    }

    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const raw = line.slice(colonIndex + 1).trim();
    if (!key) continue;

    if (!raw) continue;

    if (raw === ">" || raw === ">-" || raw === "|" || raw === "|-") {
      currentKey = key;
      multilineValue = "";
      inMultiline = true;
      continue;
    }

    const unquoted = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
    result[key] = unquoted;
  }

  if (inMultiline) flushMultiline();

  return result;
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
 * Read a SKILL.md file and return a SlashCommand.
 *
 * Parses YAML frontmatter for `name` and `description`.
 * Falls back to the directory name when `name` is absent and "Skill"
 * when `description` is absent.
 */
function readSkillFile(skillMdPath: string, dirName: string, pluginName?: string): SlashCommand {
  const content = readFileSync(skillMdPath, "utf-8");
  const meta = parseFrontmatter(content);
  const name = meta.name || dirName;
  const description = meta.description || "Skill";
  if (pluginName) {
    return { command: `/${pluginName}:${name}`, description };
  }
  return { command: `/${name}`, description };
}

/**
 * Discover slash commands from Claude Code skills.
 *
 * Scans ~/.claude/skills/{name}/SKILL.md for user skills and
 * each installed plugin's skills/{name}/SKILL.md for plugin skills.
 * Plugin skills are namespaced as /{pluginName}:{skillName}.
 */
export function discoverSkillCommands(homeDir?: string): SlashCommand[] {
  const home = homeDir ?? homedir();
  const commands: SlashCommand[] = [];

  const userSkillsDir = join(home, ".claude", "skills");
  for (const dirName of listSubdirectories(userSkillsDir)) {
    const skillMd = join(userSkillsDir, dirName, "SKILL.md");
    if (existsSync(skillMd)) {
      commands.push(readSkillFile(skillMd, dirName));
    }
  }

  const pluginsFile = join(home, ".claude", "plugins", "installed_plugins.json");
  if (existsSync(pluginsFile)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(pluginsFile, "utf-8"));
    } catch {
      parsed = null;
    }
    if (isInstalledPlugins(parsed)) {
      for (const [key, entries] of Object.entries(parsed.plugins)) {
        if (!Array.isArray(entries) || entries.length === 0) continue;
        const entry = entries[0];
        if (typeof entry?.installPath !== "string") continue;
        const pluginName = parsePluginName(key);
        const pluginSkillsDir = join(entry.installPath, "skills");
        for (const dirName of listSubdirectories(pluginSkillsDir)) {
          const skillMd = join(pluginSkillsDir, dirName, "SKILL.md");
          if (existsSync(skillMd)) {
            commands.push(readSkillFile(skillMd, dirName, pluginName));
          }
        }
      }
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
 * Priority (highest → lowest): project commands → global commands →
 * skill commands → plugin commands. When the same command name appears
 * in multiple locations, the higher-priority source wins.
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

  for (const cmd of discoverSkillCommands(home)) {
    const name = cmd.command.slice(1);
    if (!seen.has(name)) {
      seen.set(name, cmd);
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
