import { join } from "node:path";
import type { SlashCommand } from "../src/shared/types";

const DOCS_URL = "https://code.claude.com/docs/en/commands.md";
const SKILLS_DOCS_URL = "https://code.claude.com/docs/en/skills.md";
const CACHE_FILENAME = "builtin-commands.json";
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

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

/**
 * Parse the first markdown table under a given heading (h1 or h2),
 * extracting slash commands and their descriptions.
 * Stops at the next heading of equal or higher level.
 */
function parseCommandTable(markdown: string, heading: string): SlashCommand[] {
  const lines = markdown.split("\n");
  const headingPattern = new RegExp(`^(#{1,2}) ${heading}\\s*$`);
  const commands: SlashCommand[] = [];

  let inSection = false;
  let sectionLevel = 0;
  let inTable = false;
  let separatorSeen = false;

  for (const line of lines) {
    if (!inSection) {
      const headingMatch = line.match(headingPattern);
      if (headingMatch) {
        inSection = true;
        sectionLevel = headingMatch[1].length;
      }
      continue;
    }

    const nextHeading = line.match(/^(#+) /);
    if (nextHeading && nextHeading[1].length <= sectionLevel) {
      break;
    }

    if (!line.startsWith("|")) {
      inTable = false;
      separatorSeen = false;
      continue;
    }

    if (!inTable) {
      inTable = true;
      separatorSeen = false;
      continue; // skip header row
    }

    if (!separatorSeen) {
      separatorSeen = true;
      continue; // skip separator row
    }

    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (cells.length < 2) continue;

    const commandMatch = cells[0].match(/`(\/\S+?)(?:\s+[[<][^\]>]*[\]>])*`/);
    if (!commandMatch) continue;

    commands.push({
      command: commandMatch[1],
      description: stripMarkdownLinks(cells[1]),
    });
  }

  return commands;
}

export function parseBuiltinCommands(markdown: string): SlashCommand[] {
  return parseCommandTable(markdown, "Built-in commands");
}

export function parseBundledSkills(markdown: string): SlashCommand[] {
  return parseCommandTable(markdown, "Bundled skills");
}

/**
 * Fetch built-in commands and bundled skills from official docs,
 * then write combined result to file cache.
 */
export async function fetchBuiltinCommands(
  deps: BuiltinCommandFetcherDeps,
): Promise<SlashCommand[]> {
  const [docsResult, skillsResult] = await Promise.allSettled([
    deps.fetchText(DOCS_URL),
    deps.fetchText(SKILLS_DOCS_URL),
  ]);

  if (docsResult.status === "rejected") throw docsResult.reason;

  const commands = parseBuiltinCommands(docsResult.value);

  if (skillsResult.status === "fulfilled") {
    const bundled = parseBundledSkills(skillsResult.value);
    const seen = new Set(commands.map((c) => c.command));
    for (const cmd of bundled) {
      if (!seen.has(cmd.command)) {
        commands.push(cmd);
      }
    }
  }

  if (commands.length > 0) {
    const cachePath = join(deps.cacheDir, CACHE_FILENAME);
    deps.mkdirSync(deps.cacheDir);
    deps.writeFileSync(cachePath, JSON.stringify(commands, null, 2));
  }

  return commands;
}

/**
 * Read cached built-in commands from file. Returns null if unavailable.
 */
export function readCachedBuiltinCommands(deps: BuiltinCommandFetcherDeps): SlashCommand[] | null {
  const cachePath = join(deps.cacheDir, CACHE_FILENAME);
  if (!deps.existsSync(cachePath)) return null;

  const raw = deps.readFileSync(cachePath);
  // File cache is an external I/O boundary — parse errors are expected for corrupted files
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
