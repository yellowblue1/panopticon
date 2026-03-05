import { afterEach, describe, expect, it, mock } from "bun:test";
import type { SlashCommand } from "../src/shared/types";
import {
  type BuiltinCommandFetcherDeps,
  BuiltinCommandProvider,
  fetchBuiltinCommands,
  parseBuiltinCommands,
  parseBundledSkills,
  readCachedBuiltinCommands,
} from "./builtin-command-fetcher";

const SAMPLE_MARKDOWN = `# Interactive mode

## Built-in commands

Built-in commands are shortcuts for common actions.

| Command | Purpose |
| :--- | :--- |
| \`/clear\` | Clear conversation history |
| \`/compact [instructions]\` | Compact conversation with optional focus instructions |
| \`/config\` | Open the Settings interface (Config tab) |
| \`/cost\` | Show [token usage statistics](/en/costs#using-the-cost-command). More info. |
| \`/model\` | Select or change the [AI model](https://example.com). Supports arrows |

### MCP prompts

MCP servers can expose prompts.
`;

const SAMPLE_MARKDOWN_NEXT_H2 = `## Built-in commands

| Command | Purpose |
| :--- | :--- |
| \`/clear\` | Clear history |
| \`/help\` | Get help |

## Vim editor mode

Some other section.
`;

describe("parseBuiltinCommands", () => {
  it("parses standard markdown table from Built-in commands section", () => {
    const result = parseBuiltinCommands(SAMPLE_MARKDOWN);

    expect(result).toEqual([
      { command: "/clear", description: "Clear conversation history" },
      { command: "/compact", description: "Compact conversation with optional focus instructions" },
      { command: "/config", description: "Open the Settings interface (Config tab)" },
      { command: "/cost", description: "Show token usage statistics. More info." },
      { command: "/model", description: "Select or change the AI model. Supports arrows" },
    ]);
  });

  it("returns empty array when section is missing", () => {
    const markdown = "# Some other page\n\nNo commands here.";
    expect(parseBuiltinCommands(markdown)).toEqual([]);
  });

  it("stops at ### MCP prompts", () => {
    const result = parseBuiltinCommands(SAMPLE_MARKDOWN);
    const commands = result.map((c) => c.command);
    expect(commands).not.toContain("/mcp__");
  });

  it("stops at next ## heading", () => {
    const result = parseBuiltinCommands(SAMPLE_MARKDOWN_NEXT_H2);
    expect(result).toEqual([
      { command: "/clear", description: "Clear history" },
      { command: "/help", description: "Get help" },
    ]);
  });

  it("strips [arg] and <arg> from command names", () => {
    const markdown = `## Built-in commands

| Command | Purpose |
| :--- | :--- |
| \`/compact [instructions]\` | Compact conversation |
| \`/rename <name>\` | Rename session |
| \`/resume [session]\` | Resume conversation |
| \`/debug [description]\` | Debug session |
| \`/export [filename]\` | Export conversation |
`;
    const result = parseBuiltinCommands(markdown);
    expect(result).toEqual([
      { command: "/compact", description: "Compact conversation" },
      { command: "/rename", description: "Rename session" },
      { command: "/resume", description: "Resume conversation" },
      { command: "/debug", description: "Debug session" },
      { command: "/export", description: "Export conversation" },
    ]);
  });

  it("strips markdown links from descriptions", () => {
    const markdown = `## Built-in commands

| Command | Purpose |
| :--- | :--- |
| \`/cost\` | Show [token usage](/en/costs). See [guide](/en/guide) for details. |
`;
    const result = parseBuiltinCommands(markdown);
    expect(result[0].description).toBe("Show token usage. See guide for details.");
  });

  it("returns empty array for empty table", () => {
    const markdown = `## Built-in commands

| Command | Purpose |
| :--- | :--- |

### MCP prompts
`;
    expect(parseBuiltinCommands(markdown)).toEqual([]);
  });
});

const SAMPLE_SKILLS_MARKDOWN = `## Bundled skills

Bundled skills ship with Claude Code and are available in every session.

* **\`/simplify\`**: reviews your recently changed files for code reuse, quality, and efficiency issues, then fixes them.

* **\`/batch <instruction>\`**: orchestrates large-scale changes across a codebase in parallel.

* **\`/debug [description]\`**: troubleshoots your current Claude Code session by reading the session debug log.

Claude Code also includes a bundled developer platform skill.

## Getting started
`;

describe("parseBundledSkills", () => {
  it("parses bundled skills from markdown bullet list", () => {
    const result = parseBundledSkills(SAMPLE_SKILLS_MARKDOWN);

    expect(result).toEqual([
      {
        command: "/simplify",
        description:
          "reviews your recently changed files for code reuse, quality, and efficiency issues, then fixes them.",
      },
      {
        command: "/batch",
        description: "orchestrates large-scale changes across a codebase in parallel.",
      },
      {
        command: "/debug",
        description:
          "troubleshoots your current Claude Code session by reading the session debug log.",
      },
    ]);
  });

  it("returns empty array when section is missing", () => {
    expect(parseBundledSkills("# No bundled skills here")).toEqual([]);
  });

  it("stops at next ## heading", () => {
    const result = parseBundledSkills(SAMPLE_SKILLS_MARKDOWN);
    expect(result.length).toBe(3);
  });

  it("strips markdown links from descriptions", () => {
    const markdown = `## Bundled skills

* **\`/foo\`**: uses [worktrees](/en/worktrees) for isolation.

## Next
`;
    const result = parseBundledSkills(markdown);
    expect(result[0].description).toBe("uses worktrees for isolation.");
  });
});

function createMockFetchText(
  commandsMd = SAMPLE_MARKDOWN,
  skillsMd: string | null = SAMPLE_SKILLS_MARKDOWN,
) {
  return mock(async (url: string) => {
    if (url.includes("skills.md")) {
      if (skillsMd === null) throw new Error("Not found");
      return skillsMd;
    }
    return commandsMd;
  });
}

function createMockDeps(
  overrides: Partial<BuiltinCommandFetcherDeps> = {},
): BuiltinCommandFetcherDeps {
  return {
    fetchText: createMockFetchText(),
    readFileSync: mock(() => "[]"),
    writeFileSync: mock(() => {}),
    existsSync: mock(() => false),
    mkdirSync: mock(() => {}),
    cacheDir: "/tmp/test-cache",
    ...overrides,
  };
}

describe("fetchBuiltinCommands", () => {
  it("fetches commands and bundled skills, then writes cache file", async () => {
    const writeFileSync = mock((_path: string, _data: string) => {});
    const mkdirSync = mock((_path: string) => {});
    const deps = createMockDeps({ writeFileSync, mkdirSync });

    const result = await fetchBuiltinCommands(deps);

    expect(result.length).toBe(8); // 5 built-in + 3 bundled skills
    expect(result[0].command).toBe("/clear");
    expect(result.find((c) => c.command === "/simplify")).toBeTruthy();
    expect(result.find((c) => c.command === "/batch")).toBeTruthy();
    expect(mkdirSync).toHaveBeenCalledWith("/tmp/test-cache");
    expect(writeFileSync).toHaveBeenCalled();
    const writtenPath = writeFileSync.mock.calls[0][0];
    expect(writtenPath).toContain("builtin-commands.json");
  });

  it("deduplicates commands that appear in both sources", async () => {
    const skillsWithDebug = `## Bundled skills

* **\`/debug [description]\`**: troubleshoots your session.

## Next
`;
    const commandsWithDebug = `## Built-in commands

| Command | Purpose |
| :--- | :--- |
| \`/debug [description]\` | Debug session |

### MCP prompts
`;
    const deps = createMockDeps({
      fetchText: createMockFetchText(commandsWithDebug, skillsWithDebug),
    });

    const result = await fetchBuiltinCommands(deps);
    const debugCmds = result.filter((c) => c.command === "/debug");
    expect(debugCmds.length).toBe(1);
    expect(debugCmds[0].description).toBe("Debug session");
  });

  it("returns commands even when skills fetch fails", async () => {
    const deps = createMockDeps({
      fetchText: createMockFetchText(SAMPLE_MARKDOWN, null),
    });

    const result = await fetchBuiltinCommands(deps);
    expect(result.length).toBe(5);
    expect(result[0].command).toBe("/clear");
  });

  it("returns empty array when both sources are empty", async () => {
    const deps = createMockDeps({
      fetchText: createMockFetchText("# No commands here", "# No skills here"),
    });

    const result = await fetchBuiltinCommands(deps);
    expect(result).toEqual([]);
  });

  it("propagates fetch errors from commands endpoint", async () => {
    const deps = createMockDeps({
      fetchText: mock(async () => {
        throw new Error("Network error");
      }),
    });

    await expect(fetchBuiltinCommands(deps)).rejects.toThrow("Network error");
  });
});

describe("readCachedBuiltinCommands", () => {
  it("returns null when file does not exist", () => {
    const deps = createMockDeps({ existsSync: mock(() => false) });
    expect(readCachedBuiltinCommands(deps)).toBeNull();
  });

  it("reads and returns cached commands", () => {
    const cached: SlashCommand[] = [
      { command: "/clear", description: "Clear" },
      { command: "/help", description: "Help" },
    ];
    const deps = createMockDeps({
      existsSync: mock(() => true),
      readFileSync: mock(() => JSON.stringify(cached)),
    });

    const result = readCachedBuiltinCommands(deps);
    expect(result).toEqual(cached);
  });

  it("returns null for invalid JSON", () => {
    const deps = createMockDeps({
      existsSync: mock(() => true),
      readFileSync: mock(() => "not json"),
    });

    expect(readCachedBuiltinCommands(deps)).toBeNull();
  });

  it("returns null for non-array JSON", () => {
    const deps = createMockDeps({
      existsSync: mock(() => true),
      readFileSync: mock(() => JSON.stringify({ commands: [] })),
    });

    expect(readCachedBuiltinCommands(deps)).toBeNull();
  });
});

describe("BuiltinCommandProvider", () => {
  let provider: BuiltinCommandProvider;

  afterEach(() => {
    provider?.stop();
  });

  it("initializes from file cache on construction", () => {
    const cached: SlashCommand[] = [{ command: "/clear", description: "Clear" }];
    const deps = createMockDeps({
      existsSync: mock(() => true),
      readFileSync: mock(() => JSON.stringify(cached)),
    });

    provider = new BuiltinCommandProvider(deps);
    expect(provider.getCommands()).toEqual(cached);
  });

  it("returns null when no cache exists", () => {
    const deps = createMockDeps({ existsSync: mock(() => false) });

    provider = new BuiltinCommandProvider(deps);
    expect(provider.getCommands()).toBeNull();
  });

  it("updates commands after successful fetch on start", async () => {
    const deps = createMockDeps({
      existsSync: mock(() => false),
      writeFileSync: mock(() => {}),
      mkdirSync: mock(() => {}),
    });

    provider = new BuiltinCommandProvider(deps);
    expect(provider.getCommands()).toBeNull();

    await provider.start();

    const commands = provider.getCommands();
    expect(commands).not.toBeNull();
    expect(commands?.length).toBe(8); // 5 built-in + 3 bundled skills
    expect(commands?.[0].command).toBe("/clear");
    expect(commands?.find((c) => c.command === "/simplify")).toBeTruthy();
  });

  it("retains previous commands when fetch fails after start", async () => {
    const cached: SlashCommand[] = [{ command: "/help", description: "Help" }];
    let callCount = 0;
    const deps = createMockDeps({
      existsSync: mock(() => true),
      readFileSync: mock(() => JSON.stringify(cached)),
      fetchText: mock(async (_url: string) => {
        callCount++;
        if (callCount > 2) throw new Error("Network error");
        if (_url.includes("skills.md")) return SAMPLE_SKILLS_MARKDOWN;
        return SAMPLE_MARKDOWN;
      }),
    });

    provider = new BuiltinCommandProvider(deps);
    expect(provider.getCommands()).toEqual(cached);

    await provider.start();
    const afterFirst = provider.getCommands();
    expect(afterFirst?.length).toBe(8);

    await provider.refresh();
    expect(provider.getCommands()?.length).toBe(8);
  });

  it("stop clears the timer", () => {
    const deps = createMockDeps({ existsSync: mock(() => false) });
    provider = new BuiltinCommandProvider(deps);
    provider.start();
    provider.stop();
  });
});
