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

const SAMPLE_MARKDOWN = `# Commands

Commands control Claude Code from inside a session.

| Command | Purpose |
| :--- | :--- |
| \`/clear\` | Clear conversation history |
| \`/compact [instructions]\` | Compact conversation with optional focus instructions |
| \`/config\` | Open the Settings interface (Config tab) |
| \`/cost\` | Show [token usage statistics](/en/costs#using-the-cost-command). More info. |
| \`/model\` | Select or change the [AI model](https://example.com). Supports arrows |
| \`/simplify [focus]\` | **[Skill](/en/skills#bundled-skills).** Review your recently changed files for code reuse, quality, and efficiency issues, then fix them. |
| \`/batch <instruction>\` | **[Skill](/en/skills#bundled-skills).** Orchestrate large-scale changes across a codebase in parallel. |
| \`/debug [description]\` | **[Skill](/en/skills#bundled-skills).** Troubleshoot your current Claude Code session by reading the session debug log. |

## MCP prompts

MCP servers can expose prompts.
`;

describe("parseBuiltinCommands", () => {
  it("parses every command from the # Commands table", () => {
    const result = parseBuiltinCommands(SAMPLE_MARKDOWN);

    expect(result).toEqual([
      { command: "/clear", description: "Clear conversation history" },
      { command: "/compact", description: "Compact conversation with optional focus instructions" },
      { command: "/config", description: "Open the Settings interface (Config tab)" },
      { command: "/cost", description: "Show token usage statistics. More info." },
      { command: "/model", description: "Select or change the AI model. Supports arrows" },
      {
        command: "/simplify",
        description:
          "Review your recently changed files for code reuse, quality, and efficiency issues, then fix them.",
      },
      {
        command: "/batch",
        description: "Orchestrate large-scale changes across a codebase in parallel.",
      },
      {
        command: "/debug",
        description:
          "Troubleshoot your current Claude Code session by reading the session debug log.",
      },
    ]);
  });

  it("returns empty array when section is missing", () => {
    const markdown = "# Some other page\n\nNo commands here.";
    expect(parseBuiltinCommands(markdown)).toEqual([]);
  });

  it("stops at the next ## heading (e.g. MCP prompts)", () => {
    const markdown = `# Commands

| Command | Purpose |
| :--- | :--- |
| \`/clear\` | Clear history |
| \`/help\` | Get help |

## MCP prompts

| Command | Purpose |
| :--- | :--- |
| \`/mcp__foo__bar\` | Should not be picked up |
`;
    const result = parseBuiltinCommands(markdown);
    expect(result.map((c) => c.command)).toEqual(["/clear", "/help"]);
  });

  it("strips [arg] and <arg> from command names", () => {
    const markdown = `# Commands

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
    const markdown = `# Commands

| Command | Purpose |
| :--- | :--- |
| \`/cost\` | Show [token usage](/en/costs). See [guide](/en/guide) for details. |
`;
    const result = parseBuiltinCommands(markdown);
    expect(result[0].description).toBe("Show token usage. See guide for details.");
  });

  it("handles escaped pipes inside command argument lists", () => {
    const markdown = `# Commands

| Command | Purpose |
| :--- | :--- |
| \`/claude-api [migrate\\|managed-agents-onboard]\` | **[Skill](/en/skills#bundled-skills).** Load Claude API reference material. |
| \`/voice [hold\\|tap\\|off]\` | Toggle voice dictation. |
`;
    const result = parseBuiltinCommands(markdown);
    expect(result).toEqual([
      { command: "/claude-api", description: "Load Claude API reference material." },
      { command: "/voice", description: "Toggle voice dictation." },
    ]);
  });

  it("strips the **[Skill](...).** prefix from bundled skill descriptions", () => {
    const markdown = `# Commands

| Command | Purpose |
| :--- | :--- |
| \`/simplify [focus]\` | **[Skill](/en/skills#bundled-skills).** Reviews changed files. |
`;
    const result = parseBuiltinCommands(markdown);
    expect(result).toEqual([{ command: "/simplify", description: "Reviews changed files." }]);
  });

  it("returns empty array for an empty table", () => {
    const markdown = `# Commands

| Command | Purpose |
| :--- | :--- |

## MCP prompts
`;
    expect(parseBuiltinCommands(markdown)).toEqual([]);
  });
});

describe("parseBundledSkills", () => {
  it("returns only the bundled-skill rows from the # Commands table", () => {
    const result = parseBundledSkills(SAMPLE_MARKDOWN);

    expect(result).toEqual([
      {
        command: "/simplify",
        description:
          "Review your recently changed files for code reuse, quality, and efficiency issues, then fix them.",
      },
      {
        command: "/batch",
        description: "Orchestrate large-scale changes across a codebase in parallel.",
      },
      {
        command: "/debug",
        description:
          "Troubleshoot your current Claude Code session by reading the session debug log.",
      },
    ]);
  });

  it("returns empty array when no Skill rows are present", () => {
    const markdown = `# Commands

| Command | Purpose |
| :--- | :--- |
| \`/clear\` | Clear history |
`;
    expect(parseBundledSkills(markdown)).toEqual([]);
  });

  it("returns a subset of parseBuiltinCommands for the same input", () => {
    const skills = parseBundledSkills(SAMPLE_MARKDOWN);
    const all = parseBuiltinCommands(SAMPLE_MARKDOWN);
    const allByCommand = new Map(all.map((c) => [c.command, c.description]));
    for (const s of skills) {
      expect(allByCommand.get(s.command)).toBe(s.description);
    }
  });
});

function createMockFetchText(commandsMd = SAMPLE_MARKDOWN) {
  return mock(async (_url: string) => commandsMd);
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
  it("fetches the # Commands table and writes the cache file", async () => {
    const writeFileSync = mock((_path: string, _data: string) => {});
    const mkdirSync = mock((_path: string) => {});
    const deps = createMockDeps({ writeFileSync, mkdirSync });

    const result = await fetchBuiltinCommands(deps);

    expect(result.length).toBe(8);
    expect(result[0].command).toBe("/clear");
    expect(result.find((c) => c.command === "/simplify")).toBeTruthy();
    expect(result.find((c) => c.command === "/batch")).toBeTruthy();
    expect(mkdirSync).toHaveBeenCalledWith("/tmp/test-cache");
    expect(writeFileSync).toHaveBeenCalled();
    const writtenPath = writeFileSync.mock.calls[0][0];
    expect(writtenPath).toContain("builtin-commands.json");
  });

  it("returns empty array when the docs page has no command table", async () => {
    const deps = createMockDeps({
      fetchText: createMockFetchText("# No commands here\n\nnothing to see"),
    });

    const result = await fetchBuiltinCommands(deps);
    expect(result).toEqual([]);
  });

  it("propagates fetch errors", async () => {
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
    expect(commands?.length).toBe(8);
    expect(commands?.[0].command).toBe("/clear");
    expect(commands?.find((c) => c.command === "/simplify")).toBeTruthy();
  });

  it("retains previous commands when fetch fails after start", async () => {
    const cached: SlashCommand[] = [{ command: "/help", description: "Help" }];
    let callCount = 0;
    const deps = createMockDeps({
      existsSync: mock(() => true),
      readFileSync: mock(() => JSON.stringify(cached)),
      fetchText: mock(async () => {
        callCount++;
        if (callCount > 1) throw new Error("Network error");
        return SAMPLE_MARKDOWN;
      }),
    });

    provider = new BuiltinCommandProvider(deps);
    expect(provider.getCommands()).toEqual(cached);

    await provider.start();
    expect(provider.getCommands()?.length).toBe(8);

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
