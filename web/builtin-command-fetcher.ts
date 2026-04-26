import { join } from "node:path";
import type { SlashCommand } from "../src/shared/types";

const DOCS_URL = "https://code.claude.com/docs/en/commands.md";
const CACHE_FILENAME = "builtin-commands.json";
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

const COMMANDS_HEADING_RE = /^#{1,2} Commands\s*$/;
const ANY_HEADING_RE = /^#+ /;

// Bundled skills are flagged in the docs table by a leading
// `**[Skill](/en/skills#bundled-skills).** ` token. After link stripping
// this collapses to `**Skill.** `.
const SKILL_PREFIX_RE = /^\*\*Skill\.\*\*\s*/;

const COMMAND_NAME_RE = /`(\/\S+?)(?:\s+[[<][^\]>]*[\]>])*`/;

export interface BuiltinCommandFetcherDeps {
  fetchText: (url: string) => Promise<string>;
  readFileSync: (path: string) => string;
  writeFileSync: (path: string, data: string) => void;
  existsSync: (path: string) => boolean;
  mkdirSync: (path: string) => void;
  cacheDir: string;
}

function stripMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trimEnd();
}

// In GitHub-flavored markdown tables, `\|` is the escape for a literal pipe
// inside a cell. We must split on unescaped pipes only, then unescape.
function splitTableRow(line: string): string[] {
  return line
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, "|").trim())
    .filter((c) => c.length > 0);
}

interface ParsedRow {
  command: string;
  description: string;
  isSkill: boolean;
}

/**
 * Walk the markdown once, yielding rows from the first table that follows the
 * `# Commands` heading. Stops at any heading after that table, which excludes
 * the separate `## MCP prompts` table.
 */
function* iterCommandRows(markdown: string): Generator<ParsedRow> {
  const lines = markdown.split("\n");

  let inSection = false;
  let inTable = false;
  let separatorSeen = false;
  let sawAnyTable = false;

  for (const line of lines) {
    if (!inSection) {
      if (COMMANDS_HEADING_RE.test(line)) inSection = true;
      continue;
    }

    if (ANY_HEADING_RE.test(line)) {
      if (sawAnyTable) break;
      continue;
    }

    if (!line.startsWith("|")) {
      inTable = false;
      separatorSeen = false;
      continue;
    }

    if (!inTable) {
      inTable = true;
      sawAnyTable = true;
      separatorSeen = false;
      continue; // skip header row
    }

    if (!separatorSeen) {
      separatorSeen = true;
      continue; // skip separator row
    }

    const cells = splitTableRow(line);
    if (cells.length < 2) continue;

    const commandMatch = cells[0].match(COMMAND_NAME_RE);
    if (!commandMatch) continue;

    const rawDescription = stripMarkdownLinks(cells[1]);
    const isSkill = SKILL_PREFIX_RE.test(rawDescription);
    const description = isSkill ? rawDescription.replace(SKILL_PREFIX_RE, "") : rawDescription;

    yield { command: commandMatch[1], description, isSkill };
  }
}

/**
 * Parse all commands listed in the official `# Commands` reference table.
 * The table mixes built-in commands and bundled skills; both are returned.
 */
export function parseBuiltinCommands(markdown: string): SlashCommand[] {
  const result: SlashCommand[] = [];
  for (const row of iterCommandRows(markdown)) {
    result.push({ command: row.command, description: row.description });
  }
  return result;
}

/** Filter `parseBuiltinCommands` to bundled-skill rows only. */
export function parseBundledSkills(markdown: string): SlashCommand[] {
  const result: SlashCommand[] = [];
  for (const row of iterCommandRows(markdown)) {
    if (row.isSkill) result.push({ command: row.command, description: row.description });
  }
  return result;
}

/**
 * Fetch the `# Commands` reference and write the result to file cache.
 */
export async function fetchBuiltinCommands(
  deps: BuiltinCommandFetcherDeps,
): Promise<SlashCommand[]> {
  const docs = await deps.fetchText(DOCS_URL);
  const commands = parseBuiltinCommands(docs);

  if (commands.length > 0) {
    const cachePath = join(deps.cacheDir, CACHE_FILENAME);
    deps.mkdirSync(deps.cacheDir);
    deps.writeFileSync(cachePath, JSON.stringify(commands, null, 2));
  }

  return commands;
}

/** Read cached built-in commands from file. Returns null if unavailable. */
export function readCachedBuiltinCommands(deps: BuiltinCommandFetcherDeps): SlashCommand[] | null {
  const cachePath = join(deps.cacheDir, CACHE_FILENAME);
  if (!deps.existsSync(cachePath)) return null;

  const raw = deps.readFileSync(cachePath);
  // File cache is an external I/O boundary -- parse errors are expected for corrupted files
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  return parsed as SlashCommand[];
}

/**
 * Manages lifecycle for fetching and caching built-in commands.
 *
 * On construction, synchronously reads file cache for fast startup.
 * start() triggers a background fetch and sets up periodic refresh.
 */
export class BuiltinCommandProvider {
  private commands: SlashCommand[] | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly deps: BuiltinCommandFetcherDeps;

  constructor(deps: BuiltinCommandFetcherDeps) {
    this.deps = deps;
    this.commands = readCachedBuiltinCommands(deps);
  }

  getCommands(): SlashCommand[] | null {
    return this.commands;
  }

  async start(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => {
      this.refresh();
    }, REFRESH_INTERVAL_MS);
    this.timer.unref();
  }

  async refresh(): Promise<void> {
    const fetched = await fetchBuiltinCommands(this.deps).catch(() => null);
    if (fetched && fetched.length > 0) {
      this.commands = fetched;
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
