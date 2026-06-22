import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { AgentDialect, SlashCommand } from "../src/shared/types";

function listMdFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".md"));
}

function listSubdirectories(dir: string): string[] {
  if (!existsSync(dir)) return [];
  // Include symlinks: codex skill dirs are commonly symlinks into
  // ~/.claude/skills/, and Dirent#isDirectory() is lstat-based so it
  // reports symlinks as non-directories.
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() || d.isSymbolicLink())
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

    // YAML literal blocks (|, |-) preserve newlines by spec, but we collapse
    // all multiline indicators to a single line for command palette display.
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

interface PluginRoot {
  name: string;
  installPath: string;
}

interface DialectSpec {
  dialect: AgentDialect;
  prefix: "/" | "$";
  rootDir: string;
  commandsSubdir: string;
  commandLabel: string;
  resolvePlugins: (homeDir: string) => PluginRoot[];
}

const CLAUDE_SPEC: DialectSpec = {
  dialect: "claude",
  prefix: "/",
  rootDir: ".claude",
  commandsSubdir: "commands",
  commandLabel: "Custom command",
  resolvePlugins: resolveClaudePlugins,
};

const CODEX_SPEC: DialectSpec = {
  dialect: "codex",
  prefix: "$",
  rootDir: ".codex",
  commandsSubdir: "prompts",
  commandLabel: "Custom prompt",
  resolvePlugins: resolveCodexPlugins,
};

function specFor(dialect: AgentDialect): DialectSpec {
  return dialect === "codex" ? CODEX_SPEC : CLAUDE_SPEC;
}

interface ClaudePluginEntry {
  installPath: string;
}

interface ClaudeInstalledPlugins {
  plugins: Record<string, ClaudePluginEntry[]>;
}

function parsePluginName(key: string): string {
  const atIndex = key.indexOf("@");
  return atIndex === -1 ? key : key.slice(0, atIndex);
}

function isClaudeInstalledPlugins(value: unknown): value is ClaudeInstalledPlugins {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.plugins !== "object" || obj.plugins === null) return false;
  return true;
}

function resolveClaudePlugins(homeDir: string): PluginRoot[] {
  const pluginsFile = join(homeDir, ".claude", "plugins", "installed_plugins.json");
  if (!existsSync(pluginsFile)) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(pluginsFile, "utf-8"));
  } catch {
    return [];
  }
  if (!isClaudeInstalledPlugins(parsed)) return [];

  const roots: PluginRoot[] = [];
  for (const [key, entries] of Object.entries(parsed.plugins)) {
    if (!Array.isArray(entries) || entries.length === 0) continue;
    const entry = entries[0];
    if (typeof entry?.installPath !== "string") continue;
    roots.push({ name: parsePluginName(key), installPath: entry.installPath });
  }
  return roots;
}

// Codex plugins have no manifest equivalent to installed_plugins.json: each
// directory under ~/.codex/.tmp/plugins/plugins/ is treated as an installed
// plugin, with `skills/` underneath.
function resolveCodexPlugins(homeDir: string): PluginRoot[] {
  const pluginsRoot = join(homeDir, ".codex", ".tmp", "plugins", "plugins");
  return listSubdirectories(pluginsRoot).map((name) => ({
    name,
    installPath: join(pluginsRoot, name),
  }));
}

function commandFromMd(
  name: string,
  spec: DialectSpec,
  source: "global" | "project",
): SlashCommand {
  return {
    command: `${spec.prefix}${name}`,
    description: `${spec.commandLabel} (${source})`,
  };
}

function readSkillCommand(
  skillMdPath: string,
  dirName: string,
  spec: DialectSpec,
  pluginName?: string,
): SlashCommand {
  const content = readFileSync(skillMdPath, "utf-8");
  const meta = parseFrontmatter(content);
  const name = meta.name || dirName;
  const description = meta.description || "Skill";
  const command = pluginName ? `${spec.prefix}${pluginName}:${name}` : `${spec.prefix}${name}`;
  return { command, description };
}

function pluginCommandFromMd(name: string, spec: DialectSpec, pluginName: string): SlashCommand {
  return {
    command: `${spec.prefix}${pluginName}:${name}`,
    description: `Plugin command (${pluginName})`,
  };
}

function discoverCommandsIn(
  spec: DialectSpec,
  base: string,
  source: "global" | "project",
): SlashCommand[] {
  const dir = join(base, spec.rootDir, spec.commandsSubdir);
  return listMdFiles(dir).map((file) => commandFromMd(basename(file, ".md"), spec, source));
}

function discoverSkillsIn(spec: DialectSpec, base: string): SlashCommand[] {
  const dir = join(base, spec.rootDir, "skills");
  const commands: SlashCommand[] = [];
  for (const dirName of listSubdirectories(dir)) {
    const skillMd = join(dir, dirName, "SKILL.md");
    if (existsSync(skillMd)) {
      commands.push(readSkillCommand(skillMd, dirName, spec));
    }
  }
  return commands;
}

function discoverPluginCommandsFor(spec: DialectSpec, plugins: PluginRoot[]): SlashCommand[] {
  const commands: SlashCommand[] = [];
  for (const plugin of plugins) {
    const commandsDir = join(plugin.installPath, "commands");
    for (const file of listMdFiles(commandsDir)) {
      commands.push(pluginCommandFromMd(basename(file, ".md"), spec, plugin.name));
    }
  }
  return commands;
}

function discoverPluginSkillsFor(spec: DialectSpec, plugins: PluginRoot[]): SlashCommand[] {
  const commands: SlashCommand[] = [];
  for (const plugin of plugins) {
    const skillsDir = join(plugin.installPath, "skills");
    for (const dirName of listSubdirectories(skillsDir)) {
      const skillMd = join(skillsDir, dirName, "SKILL.md");
      if (existsSync(skillMd)) {
        commands.push(readSkillCommand(skillMd, dirName, spec, plugin.name));
      }
    }
  }
  return commands;
}

function bareName(command: string): string {
  return command.slice(1);
}

function mergeUnique(seen: Map<string, SlashCommand>, additions: SlashCommand[]): void {
  for (const cmd of additions) {
    const key = bareName(cmd.command);
    if (!seen.has(key)) seen.set(key, cmd);
  }
}

/**
 * Discover all commands for a given dialect across multiple session cwds.
 *
 * Priority (highest → lowest):
 *   1. project commands
 *   2. project skills
 *   3. global commands
 *   4. global skills
 *   5. plugin commands
 *   6. plugin skills
 *
 * Same-name entries from a lower-priority source are dropped.
 */
export function discoverDialectCommands(
  dialect: AgentDialect,
  cwds: string[],
  homeDir?: string,
): SlashCommand[] {
  const spec = specFor(dialect);
  const home = homeDir ?? homedir();
  const plugins = spec.resolvePlugins(home);
  const seen = new Map<string, SlashCommand>();

  for (const cwd of cwds) mergeUnique(seen, discoverCommandsIn(spec, cwd, "project"));
  for (const cwd of cwds) mergeUnique(seen, discoverSkillsIn(spec, cwd));
  mergeUnique(seen, discoverCommandsIn(spec, home, "global"));
  mergeUnique(seen, discoverSkillsIn(spec, home));
  mergeUnique(seen, discoverPluginCommandsFor(spec, plugins));
  mergeUnique(seen, discoverPluginSkillsFor(spec, plugins));

  return [...seen.values()].sort((a, b) => a.command.localeCompare(b.command));
}

// Legacy claude-only exports: kept as a regression safety net for the existing
// test suite that pins per-source behavior; new callers should use
// discoverDialectCommands directly.

export function discoverPluginCommands(homeDir?: string): SlashCommand[] {
  const home = homeDir ?? homedir();
  return discoverPluginCommandsFor(CLAUDE_SPEC, CLAUDE_SPEC.resolvePlugins(home)).sort((a, b) =>
    a.command.localeCompare(b.command),
  );
}

export function discoverSkillCommands(homeDir?: string): SlashCommand[] {
  const home = homeDir ?? homedir();
  const plugins = CLAUDE_SPEC.resolvePlugins(home);
  return [
    ...discoverSkillsIn(CLAUDE_SPEC, home),
    ...discoverPluginSkillsFor(CLAUDE_SPEC, plugins),
  ].sort((a, b) => a.command.localeCompare(b.command));
}

export function discoverSlashCommands(cwd: string, homeDir?: string): SlashCommand[] {
  const home = homeDir ?? homedir();
  const seen = new Map<string, SlashCommand>();
  mergeUnique(seen, discoverCommandsIn(CLAUDE_SPEC, cwd, "project"));
  mergeUnique(seen, discoverCommandsIn(CLAUDE_SPEC, home, "global"));
  return [...seen.values()].sort((a, b) => a.command.localeCompare(b.command));
}

export function discoverAllSlashCommands(cwds: string[], homeDir?: string): SlashCommand[] {
  return discoverDialectCommands("claude", cwds, homeDir);
}
