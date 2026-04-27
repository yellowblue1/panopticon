import { join } from "node:path";
import type { SlashCommand } from "../src/shared/types";

const DOCS_URL = "https://code.claude.com/docs/en/commands.md";
const CACHE_FILENAME = "builtin-commands.json";
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

const COMMANDS_HEADING_RE = /^#{1,2} Commands\s*$/;
const ANY_HEADING_RE = /^#+ /;

// Bundled skills are flagged on the raw description cell by a leading
// `**[Skill](/en/skills...)` token. Detecting on the raw cell (before
// link stripping) is more stable than matching the post-strip residue.
const SKILL_LINK_PREFIX = "**[Skill](/en/skills";

const COMMAND_NAME_RE = /`(\/\S+?)(?:\s+[[<][^\]>]*[\]>])*`/;

// MDX comments like `{/* max-version: 2.1.91 */}` appear inline in some rows
// (e.g. `/pr-comments`, `/vim`) and would otherwise leak into descriptions.
const MDX_COMMENT_RE = /\{\/\*[\s\S]*?\*\/\}/g;

export interface BuiltinCommandFetcherDeps {
  fetchText: (url: string) => Promise<string>;
  readFileSync: (path: string) => string;
  writeFileSync: (path: string, data: string) => void;
  existsSync: (path: string) => boolean;
  mkdirSync: (path: string) => void;
  cacheDir: string;
}

function cleanDescription(text: string): string {
  return text
    .replace(MDX_COMMENT_RE, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
}

// In GitHub-flavored markdown tables, `\|` is the escape for a literal pipe
// inside a cell. Split on unescaped pipes only, then unescape.
function splitTableRow(line: string): string[] {
  return line
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, "|").trim())
    .filter((c) => c.length > 0);
}

/**
 * Strip the `**[Skill](...).** ` lead-in from a description after links have
 * been collapsed. Handles optional period and stray whitespace so the parser
 * survives small upstream wording tweaks.
 */
function stripSkillLeadIn(description: string): string {
  return description.replace(/^\*\*Skill[^*]*\*\*\s*/, "");
}

/**
 * Parse all commands listed in the official `# Commands` reference table.
 * The table mixes built-in commands and bundled skills; both are returned.
 *
 * Stops at any heading that follows the table, which excludes the separate
 * `## MCP prompts` section.
 */
export function parseBuiltinCommands(markdown: string): SlashCommand[] {
  const lines = markdown.split("\n");
  const commands: SlashCommand[] = [];

  let inSection = false;
  let inTable = false;
  let separatorSeen = false;
  let sawAnyTable = false;

  for (const rawLine of lines) {
    if (!inSection) {
      if (COMMANDS_HEADING_RE.test(rawLine)) inSection = true;
      continue;
    }

    if (ANY_HEADING_RE.test(rawLine)) {
      if (sawAnyTable) break;
      continue;
    }

    // Tolerate soft indentation around the table.
    const line = rawLine.trimStart();

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

    const isSkill = cells[1].startsWith(SKILL_LINK_PREFIX);
    const description = isSkill
      ? stripSkillLeadIn(cleanDescription(cells[1]))
      : cleanDescription(cells[1]);

    commands.push({ command: commandMatch[1], description });
  }

  return commands;
}

/** Fetch the `# Commands` reference and write the result to file cache. */
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
    const fetched = await fetchBuiltinCommands(this.deps).catch((err: unknown) => {
      console.warn("[builtin-commands] fetch failed:", err);
      return null;
    });
    if (fetched === null) return;
    if (fetched.length === 0) {
      // Empty result means the docs format probably changed and the parser
      // could not extract any rows -- this is exactly the regression that
      // motivated the previous fix, so surface it instead of silently
      // serving the stale cache.
      console.warn(
        "[builtin-commands] parser returned 0 rows -- possible docs format change at",
        DOCS_URL,
      );
      return;
    }
    this.commands = fetched;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
