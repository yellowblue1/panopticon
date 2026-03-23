import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverAllSlashCommands,
  discoverPluginCommands,
  discoverSkillCommands,
  discoverSlashCommands,
} from "./command-discovery";

function createTempDir(): string {
  const dir = join(
    tmpdir(),
    `panopticon-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("discoverSlashCommands", () => {
  it("returns empty array when no commands directories exist", () => {
    const homeDir = createTempDir();
    const cwd = createTempDir();

    try {
      const commands = discoverSlashCommands(cwd, homeDir);
      expect(commands).toEqual([]);
    } finally {
      rmSync(homeDir, { recursive: true });
      rmSync(cwd, { recursive: true });
    }
  });

  it("discovers global commands from ~/.claude/commands/", () => {
    const homeDir = createTempDir();
    const cwd = createTempDir();
    const commandsDir = join(homeDir, ".claude", "commands");
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(join(commandsDir, "commit.md"), "# Commit");
    writeFileSync(join(commandsDir, "review-pr.md"), "# Review PR");

    try {
      const commands = discoverSlashCommands(cwd, homeDir);
      expect(commands).toEqual([
        { command: "/commit", description: "Custom command (global)" },
        { command: "/review-pr", description: "Custom command (global)" },
      ]);
    } finally {
      rmSync(homeDir, { recursive: true });
      rmSync(cwd, { recursive: true });
    }
  });

  it("discovers project commands from {cwd}/.claude/commands/", () => {
    const homeDir = createTempDir();
    const cwd = createTempDir();
    const commandsDir = join(cwd, ".claude", "commands");
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(join(commandsDir, "deploy.md"), "# Deploy");

    try {
      const commands = discoverSlashCommands(cwd, homeDir);
      expect(commands).toEqual([{ command: "/deploy", description: "Custom command (project)" }]);
    } finally {
      rmSync(homeDir, { recursive: true });
      rmSync(cwd, { recursive: true });
    }
  });

  it("merges global and project commands, sorted alphabetically", () => {
    const homeDir = createTempDir();
    const cwd = createTempDir();

    const globalDir = join(homeDir, ".claude", "commands");
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, "commit.md"), "# Commit");

    const projectDir = join(cwd, ".claude", "commands");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "deploy.md"), "# Deploy");

    try {
      const commands = discoverSlashCommands(cwd, homeDir);
      expect(commands).toEqual([
        { command: "/commit", description: "Custom command (global)" },
        { command: "/deploy", description: "Custom command (project)" },
      ]);
    } finally {
      rmSync(homeDir, { recursive: true });
      rmSync(cwd, { recursive: true });
    }
  });

  it("project commands with same name as global are deduplicated (project wins)", () => {
    const homeDir = createTempDir();
    const cwd = createTempDir();

    const globalDir = join(homeDir, ".claude", "commands");
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, "commit.md"), "# Global commit");

    const projectDir = join(cwd, ".claude", "commands");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "commit.md"), "# Project commit");

    try {
      const commands = discoverSlashCommands(cwd, homeDir);
      expect(commands).toEqual([{ command: "/commit", description: "Custom command (project)" }]);
    } finally {
      rmSync(homeDir, { recursive: true });
      rmSync(cwd, { recursive: true });
    }
  });

  it("ignores non-.md files", () => {
    const homeDir = createTempDir();
    const cwd = createTempDir();
    const commandsDir = join(homeDir, ".claude", "commands");
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(join(commandsDir, "commit.md"), "# Commit");
    writeFileSync(join(commandsDir, "notes.txt"), "not a command");
    writeFileSync(join(commandsDir, ".hidden"), "hidden file");

    try {
      const commands = discoverSlashCommands(cwd, homeDir);
      expect(commands).toEqual([{ command: "/commit", description: "Custom command (global)" }]);
    } finally {
      rmSync(homeDir, { recursive: true });
      rmSync(cwd, { recursive: true });
    }
  });
});

describe("discoverAllSlashCommands", () => {
  it("returns empty array when cwds is empty", () => {
    const homeDir = createTempDir();

    try {
      const commands = discoverAllSlashCommands([], homeDir);
      expect(commands).toEqual([]);
    } finally {
      rmSync(homeDir, { recursive: true });
    }
  });

  it("returns only global commands when cwds have no project commands", () => {
    const homeDir = createTempDir();
    const cwd = createTempDir();
    const globalDir = join(homeDir, ".claude", "commands");
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, "commit.md"), "# Commit");

    try {
      const commands = discoverAllSlashCommands([cwd], homeDir);
      expect(commands).toEqual([{ command: "/commit", description: "Custom command (global)" }]);
    } finally {
      rmSync(homeDir, { recursive: true });
      rmSync(cwd, { recursive: true });
    }
  });

  it("merges commands from multiple cwds with project taking priority over global", () => {
    const homeDir = createTempDir();
    const cwd1 = createTempDir();
    const cwd2 = createTempDir();

    const globalDir = join(homeDir, ".claude", "commands");
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, "global-cmd.md"), "# Global");
    writeFileSync(join(globalDir, "shared.md"), "# Global shared");

    const projectDir1 = join(cwd1, ".claude", "commands");
    mkdirSync(projectDir1, { recursive: true });
    writeFileSync(join(projectDir1, "project1-cmd.md"), "# Project 1");
    writeFileSync(join(projectDir1, "shared.md"), "# Project 1 shared");

    const projectDir2 = join(cwd2, ".claude", "commands");
    mkdirSync(projectDir2, { recursive: true });
    writeFileSync(join(projectDir2, "project2-cmd.md"), "# Project 2");

    try {
      const commands = discoverAllSlashCommands([cwd1, cwd2], homeDir);
      expect(commands).toEqual([
        { command: "/global-cmd", description: "Custom command (global)" },
        { command: "/project1-cmd", description: "Custom command (project)" },
        { command: "/project2-cmd", description: "Custom command (project)" },
        { command: "/shared", description: "Custom command (project)" },
      ]);
    } finally {
      rmSync(homeDir, { recursive: true });
      rmSync(cwd1, { recursive: true });
      rmSync(cwd2, { recursive: true });
    }
  });

  it("deduplicates commands across multiple cwds (first cwd wins)", () => {
    const homeDir = createTempDir();
    const cwd1 = createTempDir();
    const cwd2 = createTempDir();

    const projectDir1 = join(cwd1, ".claude", "commands");
    mkdirSync(projectDir1, { recursive: true });
    writeFileSync(join(projectDir1, "deploy.md"), "# Deploy from project 1");

    const projectDir2 = join(cwd2, ".claude", "commands");
    mkdirSync(projectDir2, { recursive: true });
    writeFileSync(join(projectDir2, "deploy.md"), "# Deploy from project 2");

    try {
      const commands = discoverAllSlashCommands([cwd1, cwd2], homeDir);
      expect(commands).toEqual([{ command: "/deploy", description: "Custom command (project)" }]);
    } finally {
      rmSync(homeDir, { recursive: true });
      rmSync(cwd1, { recursive: true });
      rmSync(cwd2, { recursive: true });
    }
  });

  it("returns global commands even when cwds is empty array", () => {
    const homeDir = createTempDir();
    const globalDir = join(homeDir, ".claude", "commands");
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, "global-only.md"), "# Global");

    try {
      const commands = discoverAllSlashCommands([], homeDir);
      expect(commands).toEqual([
        { command: "/global-only", description: "Custom command (global)" },
      ]);
    } finally {
      rmSync(homeDir, { recursive: true });
    }
  });

  it("includes plugin commands alongside project and global commands", () => {
    const homeDir = createTempDir();
    const cwd = createTempDir();

    const globalDir = join(homeDir, ".claude", "commands");
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, "shared.md"), "# Global shared");

    const projectDir = join(cwd, ".claude", "commands");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "shared.md"), "# Project shared");

    const pluginDir = join(homeDir, ".claude", "plugins");
    const pluginCommandsDir = join(
      pluginDir,
      "cache",
      "marketplace",
      "my-plugin",
      "v1",
      "commands",
    );
    mkdirSync(pluginCommandsDir, { recursive: true });
    writeFileSync(join(pluginCommandsDir, "shared.md"), "# Plugin shared");
    writeFileSync(join(pluginCommandsDir, "plugin-only.md"), "# Plugin only");
    writeFileSync(
      join(pluginDir, "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: {
          "my-plugin@marketplace": [
            {
              scope: "user",
              installPath: join(pluginDir, "cache", "marketplace", "my-plugin", "v1"),
              version: "v1",
              installedAt: "2025-01-01T00:00:00.000Z",
              lastUpdated: "2025-01-01T00:00:00.000Z",
            },
          ],
        },
      }),
    );

    try {
      const commands = discoverAllSlashCommands([cwd], homeDir);
      expect(commands).toEqual([
        { command: "/my-plugin:plugin-only", description: "Plugin command (my-plugin)" },
        { command: "/my-plugin:shared", description: "Plugin command (my-plugin)" },
        { command: "/shared", description: "Custom command (project)" },
      ]);
    } finally {
      rmSync(homeDir, { recursive: true });
      rmSync(cwd, { recursive: true });
    }
  });
});

describe("discoverPluginCommands", () => {
  it("returns empty array when installed_plugins.json does not exist", () => {
    const homeDir = createTempDir();

    try {
      const commands = discoverPluginCommands(homeDir);
      expect(commands).toEqual([]);
    } finally {
      rmSync(homeDir, { recursive: true });
    }
  });

  it("discovers commands from a plugin with commands/ directory", () => {
    const homeDir = createTempDir();
    const pluginDir = join(homeDir, ".claude", "plugins");
    const pluginCommandsDir = join(
      pluginDir,
      "cache",
      "marketplace",
      "my-plugin",
      "v1",
      "commands",
    );
    mkdirSync(pluginCommandsDir, { recursive: true });
    writeFileSync(join(pluginCommandsDir, "deploy.md"), "# Deploy");
    writeFileSync(
      join(pluginDir, "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: {
          "my-plugin@marketplace": [
            {
              scope: "user",
              installPath: join(pluginDir, "cache", "marketplace", "my-plugin", "v1"),
              version: "v1",
              installedAt: "2025-01-01T00:00:00.000Z",
              lastUpdated: "2025-01-01T00:00:00.000Z",
            },
          ],
        },
      }),
    );

    try {
      const commands = discoverPluginCommands(homeDir);
      expect(commands).toEqual([
        { command: "/my-plugin:deploy", description: "Plugin command (my-plugin)" },
      ]);
    } finally {
      rmSync(homeDir, { recursive: true });
    }
  });

  it("merges commands from multiple plugins", () => {
    const homeDir = createTempDir();
    const pluginDir = join(homeDir, ".claude", "plugins");

    const plugin1Dir = join(pluginDir, "cache", "mp", "alpha", "v1", "commands");
    mkdirSync(plugin1Dir, { recursive: true });
    writeFileSync(join(plugin1Dir, "cmd-a.md"), "# A");

    const plugin2Dir = join(pluginDir, "cache", "mp", "beta", "v2", "commands");
    mkdirSync(plugin2Dir, { recursive: true });
    writeFileSync(join(plugin2Dir, "cmd-b.md"), "# B");

    writeFileSync(
      join(pluginDir, "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: {
          "alpha@mp": [
            {
              scope: "user",
              installPath: join(pluginDir, "cache", "mp", "alpha", "v1"),
              version: "v1",
              installedAt: "2025-01-01T00:00:00.000Z",
              lastUpdated: "2025-01-01T00:00:00.000Z",
            },
          ],
          "beta@mp": [
            {
              scope: "user",
              installPath: join(pluginDir, "cache", "mp", "beta", "v2"),
              version: "v2",
              installedAt: "2025-01-01T00:00:00.000Z",
              lastUpdated: "2025-01-01T00:00:00.000Z",
            },
          ],
        },
      }),
    );

    try {
      const commands = discoverPluginCommands(homeDir);
      expect(commands).toEqual([
        { command: "/alpha:cmd-a", description: "Plugin command (alpha)" },
        { command: "/beta:cmd-b", description: "Plugin command (beta)" },
      ]);
    } finally {
      rmSync(homeDir, { recursive: true });
    }
  });

  it("handles invalid installed_plugins.json gracefully", () => {
    const homeDir = createTempDir();
    const pluginDir = join(homeDir, ".claude", "plugins");
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, "installed_plugins.json"), "not valid json{{{");

    try {
      const commands = discoverPluginCommands(homeDir);
      expect(commands).toEqual([]);
    } finally {
      rmSync(homeDir, { recursive: true });
    }
  });

  it("ignores plugins without commands/ directory", () => {
    const homeDir = createTempDir();
    const pluginDir = join(homeDir, ".claude", "plugins");
    const pluginInstallDir = join(pluginDir, "cache", "mp", "no-cmds", "v1");
    mkdirSync(pluginInstallDir, { recursive: true });

    writeFileSync(
      join(pluginDir, "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: {
          "no-cmds@mp": [
            {
              scope: "user",
              installPath: pluginInstallDir,
              version: "v1",
              installedAt: "2025-01-01T00:00:00.000Z",
              lastUpdated: "2025-01-01T00:00:00.000Z",
            },
          ],
        },
      }),
    );

    try {
      const commands = discoverPluginCommands(homeDir);
      expect(commands).toEqual([]);
    } finally {
      rmSync(homeDir, { recursive: true });
    }
  });

  it("handles plugins with empty plugins object", () => {
    const homeDir = createTempDir();
    const pluginDir = join(homeDir, ".claude", "plugins");
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, "installed_plugins.json"),
      JSON.stringify({ version: 2, plugins: {} }),
    );

    try {
      const commands = discoverPluginCommands(homeDir);
      expect(commands).toEqual([]);
    } finally {
      rmSync(homeDir, { recursive: true });
    }
  });

  it("uses first entry when plugin has multiple installations", () => {
    const homeDir = createTempDir();
    const pluginDir = join(homeDir, ".claude", "plugins");

    const installDir = join(pluginDir, "cache", "mp", "multi", "v2");
    const commandsDir = join(installDir, "commands");
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(join(commandsDir, "run.md"), "# Run");

    writeFileSync(
      join(pluginDir, "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: {
          "multi@mp": [
            {
              scope: "user",
              installPath: installDir,
              version: "v2",
              installedAt: "2025-01-02T00:00:00.000Z",
              lastUpdated: "2025-01-02T00:00:00.000Z",
            },
            {
              scope: "user",
              installPath: join(pluginDir, "cache", "mp", "multi", "v1"),
              version: "v1",
              installedAt: "2025-01-01T00:00:00.000Z",
              lastUpdated: "2025-01-01T00:00:00.000Z",
            },
          ],
        },
      }),
    );

    try {
      const commands = discoverPluginCommands(homeDir);
      expect(commands).toEqual([{ command: "/multi:run", description: "Plugin command (multi)" }]);
    } finally {
      rmSync(homeDir, { recursive: true });
    }
  });
});

describe("discoverSkillCommands", () => {
  it("returns empty array when ~/.claude/skills/ does not exist", () => {
    const homeDir = createTempDir();

    try {
      const commands = discoverSkillCommands(homeDir);
      expect(commands).toEqual([]);
    } finally {
      rmSync(homeDir, { recursive: true });
    }
  });

  it("discovers skills with valid SKILL.md frontmatter", () => {
    const homeDir = createTempDir();
    const skillDir = join(homeDir, ".claude", "skills", "dev-flow");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      '---\nname: dev-flow\ndescription: Orchestrate development workflow\nargument-hint: "[--from=<step>]"\n---\n\n# Dev Flow',
    );

    try {
      const commands = discoverSkillCommands(homeDir);
      expect(commands).toEqual([
        { command: "/dev-flow", description: "Orchestrate development workflow" },
      ]);
    } finally {
      rmSync(homeDir, { recursive: true });
    }
  });

  it("uses directory name when name field is missing from frontmatter", () => {
    const homeDir = createTempDir();
    const skillDir = join(homeDir, ".claude", "skills", "my-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\ndescription: A useful skill\n---\n\n# My Skill",
    );

    try {
      const commands = discoverSkillCommands(homeDir);
      expect(commands).toEqual([{ command: "/my-skill", description: "A useful skill" }]);
    } finally {
      rmSync(homeDir, { recursive: true });
    }
  });

  it("falls back to 'Skill' description when description field is missing", () => {
    const homeDir = createTempDir();
    const skillDir = join(homeDir, ".claude", "skills", "bare-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: bare-skill\n---\n\n# Bare Skill");

    try {
      const commands = discoverSkillCommands(homeDir);
      expect(commands).toEqual([{ command: "/bare-skill", description: "Skill" }]);
    } finally {
      rmSync(homeDir, { recursive: true });
    }
  });

  it("parses YAML folded string (>) in description", () => {
    const homeDir = createTempDir();
    const skillDir = join(homeDir, ".claude", "skills", "seo-tool");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: seo-tool\ndescription: >\n  SEO content drafting for blog\n  and help articles.\n---\n\n# SEO Tool",
    );

    try {
      const commands = discoverSkillCommands(homeDir);
      expect(commands).toEqual([
        { command: "/seo-tool", description: "SEO content drafting for blog and help articles." },
      ]);
    } finally {
      rmSync(homeDir, { recursive: true });
    }
  });

  it("parses YAML folded strip (>-) in description", () => {
    const homeDir = createTempDir();
    const skillDir = join(homeDir, ".claude", "skills", "my-flow");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: my-flow\ndescription: >-\n  Orchestrate development\n  workflow steps.\n---\n\n# My Flow",
    );

    try {
      const commands = discoverSkillCommands(homeDir);
      expect(commands).toEqual([
        { command: "/my-flow", description: "Orchestrate development workflow steps." },
      ]);
    } finally {
      rmSync(homeDir, { recursive: true });
    }
  });

  it("parses YAML literal block (|) in description, collapsing to single line", () => {
    const homeDir = createTempDir();
    const skillDir = join(homeDir, ".claude", "skills", "lint-tool");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: lint-tool\ndescription: |\n  Run linting across\n  the entire project.\n---\n\n# Lint",
    );

    try {
      const commands = discoverSkillCommands(homeDir);
      expect(commands).toEqual([
        { command: "/lint-tool", description: "Run linting across the entire project." },
      ]);
    } finally {
      rmSync(homeDir, { recursive: true });
    }
  });

  it("parses YAML literal strip (|-) in description, collapsing to single line", () => {
    const homeDir = createTempDir();
    const skillDir = join(homeDir, ".claude", "skills", "fmt-tool");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: fmt-tool\ndescription: |-\n  Format all source\n  files consistently.\n---\n\n# Format",
    );

    try {
      const commands = discoverSkillCommands(homeDir);
      expect(commands).toEqual([
        { command: "/fmt-tool", description: "Format all source files consistently." },
      ]);
    } finally {
      rmSync(homeDir, { recursive: true });
    }
  });

  it("handles SKILL.md without frontmatter delimiters", () => {
    const homeDir = createTempDir();
    const skillDir = join(homeDir, ".claude", "skills", "no-front");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# Just markdown content");

    try {
      const commands = discoverSkillCommands(homeDir);
      expect(commands).toEqual([{ command: "/no-front", description: "Skill" }]);
    } finally {
      rmSync(homeDir, { recursive: true });
    }
  });

  it("handles empty skills directory", () => {
    const homeDir = createTempDir();
    const skillsDir = join(homeDir, ".claude", "skills");
    mkdirSync(skillsDir, { recursive: true });

    try {
      const commands = discoverSkillCommands(homeDir);
      expect(commands).toEqual([]);
    } finally {
      rmSync(homeDir, { recursive: true });
    }
  });

  it("discovers multiple skills sorted alphabetically", () => {
    const homeDir = createTempDir();
    const skillsDir = join(homeDir, ".claude", "skills");

    const skillA = join(skillsDir, "alpha");
    mkdirSync(skillA, { recursive: true });
    writeFileSync(join(skillA, "SKILL.md"), "---\nname: alpha\ndescription: Alpha skill\n---\n");

    const skillB = join(skillsDir, "beta");
    mkdirSync(skillB, { recursive: true });
    writeFileSync(join(skillB, "SKILL.md"), "---\nname: beta\ndescription: Beta skill\n---\n");

    try {
      const commands = discoverSkillCommands(homeDir);
      expect(commands).toEqual([
        { command: "/alpha", description: "Alpha skill" },
        { command: "/beta", description: "Beta skill" },
      ]);
    } finally {
      rmSync(homeDir, { recursive: true });
    }
  });

  it("ignores subdirectories without SKILL.md", () => {
    const homeDir = createTempDir();
    const skillsDir = join(homeDir, ".claude", "skills");

    const validSkill = join(skillsDir, "valid");
    mkdirSync(validSkill, { recursive: true });
    writeFileSync(
      join(validSkill, "SKILL.md"),
      "---\nname: valid\ndescription: Valid skill\n---\n",
    );

    const invalidSkill = join(skillsDir, "invalid");
    mkdirSync(invalidSkill, { recursive: true });
    writeFileSync(join(invalidSkill, "README.md"), "# Not a skill");

    try {
      const commands = discoverSkillCommands(homeDir);
      expect(commands).toEqual([{ command: "/valid", description: "Valid skill" }]);
    } finally {
      rmSync(homeDir, { recursive: true });
    }
  });

  it("discovers plugin-provided skills with namespace format", () => {
    const homeDir = createTempDir();
    const pluginDir = join(homeDir, ".claude", "plugins");
    const pluginInstallDir = join(pluginDir, "cache", "mp", "my-plugin", "v1");
    const pluginSkillDir = join(pluginInstallDir, "skills", "deploy");
    mkdirSync(pluginSkillDir, { recursive: true });
    writeFileSync(
      join(pluginSkillDir, "SKILL.md"),
      "---\nname: deploy\ndescription: Deploy to production\n---\n",
    );

    writeFileSync(
      join(pluginDir, "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: {
          "my-plugin@mp": [
            {
              scope: "user",
              installPath: pluginInstallDir,
              version: "v1",
              installedAt: "2025-01-01T00:00:00.000Z",
              lastUpdated: "2025-01-01T00:00:00.000Z",
            },
          ],
        },
      }),
    );

    try {
      const commands = discoverSkillCommands(homeDir);
      expect(commands).toEqual([
        { command: "/my-plugin:deploy", description: "Deploy to production" },
      ]);
    } finally {
      rmSync(homeDir, { recursive: true });
    }
  });

  it("merges user skills and plugin skills", () => {
    const homeDir = createTempDir();

    const userSkillDir = join(homeDir, ".claude", "skills", "my-flow");
    mkdirSync(userSkillDir, { recursive: true });
    writeFileSync(
      join(userSkillDir, "SKILL.md"),
      "---\nname: my-flow\ndescription: My workflow\n---\n",
    );

    const pluginDir = join(homeDir, ".claude", "plugins");
    const pluginInstallDir = join(pluginDir, "cache", "mp", "tool", "v1");
    const pluginSkillDir = join(pluginInstallDir, "skills", "analyze");
    mkdirSync(pluginSkillDir, { recursive: true });
    writeFileSync(
      join(pluginSkillDir, "SKILL.md"),
      "---\nname: analyze\ndescription: Analyze code\n---\n",
    );

    writeFileSync(
      join(pluginDir, "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: {
          "tool@mp": [
            {
              scope: "user",
              installPath: pluginInstallDir,
              version: "v1",
              installedAt: "2025-01-01T00:00:00.000Z",
              lastUpdated: "2025-01-01T00:00:00.000Z",
            },
          ],
        },
      }),
    );

    try {
      const commands = discoverSkillCommands(homeDir);
      expect(commands).toEqual([
        { command: "/my-flow", description: "My workflow" },
        { command: "/tool:analyze", description: "Analyze code" },
      ]);
    } finally {
      rmSync(homeDir, { recursive: true });
    }
  });
});

describe("discoverAllSlashCommands with skills", () => {
  it("includes skill commands alongside project, global, and plugin commands", () => {
    const homeDir = createTempDir();
    const cwd = createTempDir();

    const globalDir = join(homeDir, ".claude", "commands");
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, "commit.md"), "# Commit");

    const projectDir = join(cwd, ".claude", "commands");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "deploy.md"), "# Deploy");

    const skillDir = join(homeDir, ".claude", "skills", "dev-flow");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: dev-flow\ndescription: Development workflow\n---\n",
    );

    try {
      const commands = discoverAllSlashCommands([cwd], homeDir);
      expect(commands).toEqual([
        { command: "/commit", description: "Custom command (global)" },
        { command: "/deploy", description: "Custom command (project)" },
        { command: "/dev-flow", description: "Development workflow" },
      ]);
    } finally {
      rmSync(homeDir, { recursive: true });
      rmSync(cwd, { recursive: true });
    }
  });

  it("commands with same name as skills take priority (command wins)", () => {
    const homeDir = createTempDir();
    const cwd = createTempDir();

    const globalDir = join(homeDir, ".claude", "commands");
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, "deploy.md"), "# Deploy command");

    const skillDir = join(homeDir, ".claude", "skills", "deploy");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: deploy\ndescription: Deploy skill\n---\n",
    );

    try {
      const commands = discoverAllSlashCommands([cwd], homeDir);
      expect(commands).toEqual([{ command: "/deploy", description: "Custom command (global)" }]);
    } finally {
      rmSync(homeDir, { recursive: true });
      rmSync(cwd, { recursive: true });
    }
  });

  it("skills have priority over plugin commands with same base name", () => {
    const homeDir = createTempDir();

    const skillDir = join(homeDir, ".claude", "skills", "review");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: review\ndescription: Code review skill\n---\n",
    );

    const pluginDir = join(homeDir, ".claude", "plugins");
    const pluginCommandsDir = join(pluginDir, "cache", "mp", "tool", "v1", "commands");
    mkdirSync(pluginCommandsDir, { recursive: true });
    writeFileSync(join(pluginCommandsDir, "plugin-cmd.md"), "# Plugin cmd");
    writeFileSync(
      join(pluginDir, "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: {
          "tool@mp": [
            {
              scope: "user",
              installPath: join(pluginDir, "cache", "mp", "tool", "v1"),
              version: "v1",
              installedAt: "2025-01-01T00:00:00.000Z",
              lastUpdated: "2025-01-01T00:00:00.000Z",
            },
          ],
        },
      }),
    );

    try {
      const commands = discoverAllSlashCommands([], homeDir);
      expect(commands).toEqual([
        { command: "/review", description: "Code review skill" },
        { command: "/tool:plugin-cmd", description: "Plugin command (tool)" },
      ]);
    } finally {
      rmSync(homeDir, { recursive: true });
    }
  });

  it("discovers project-level skills from {cwd}/.claude/skills/", () => {
    const homeDir = createTempDir();
    const cwd = createTempDir();

    const projectSkillDir = join(cwd, ".claude", "skills", "seo-content");
    mkdirSync(projectSkillDir, { recursive: true });
    writeFileSync(
      join(projectSkillDir, "SKILL.md"),
      "---\nname: seo-content\ndescription: SEO content drafting\n---\n",
    );

    try {
      const commands = discoverAllSlashCommands([cwd], homeDir);
      expect(commands).toEqual([{ command: "/seo-content", description: "SEO content drafting" }]);
    } finally {
      rmSync(homeDir, { recursive: true });
      rmSync(cwd, { recursive: true });
    }
  });

  it("project skills have higher priority than global skills", () => {
    const homeDir = createTempDir();
    const cwd = createTempDir();

    const globalSkillDir = join(homeDir, ".claude", "skills", "deploy");
    mkdirSync(globalSkillDir, { recursive: true });
    writeFileSync(
      join(globalSkillDir, "SKILL.md"),
      "---\nname: deploy\ndescription: Global deploy\n---\n",
    );

    const projectSkillDir = join(cwd, ".claude", "skills", "deploy");
    mkdirSync(projectSkillDir, { recursive: true });
    writeFileSync(
      join(projectSkillDir, "SKILL.md"),
      "---\nname: deploy\ndescription: Project deploy\n---\n",
    );

    try {
      const commands = discoverAllSlashCommands([cwd], homeDir);
      expect(commands).toEqual([{ command: "/deploy", description: "Project deploy" }]);
    } finally {
      rmSync(homeDir, { recursive: true });
      rmSync(cwd, { recursive: true });
    }
  });

  it("project commands take priority over project skills with same name", () => {
    const homeDir = createTempDir();
    const cwd = createTempDir();

    const projectDir = join(cwd, ".claude", "commands");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "test.md"), "# Test command");

    const projectSkillDir = join(cwd, ".claude", "skills", "test");
    mkdirSync(projectSkillDir, { recursive: true });
    writeFileSync(
      join(projectSkillDir, "SKILL.md"),
      "---\nname: test\ndescription: Test skill\n---\n",
    );

    try {
      const commands = discoverAllSlashCommands([cwd], homeDir);
      expect(commands).toEqual([{ command: "/test", description: "Custom command (project)" }]);
    } finally {
      rmSync(homeDir, { recursive: true });
      rmSync(cwd, { recursive: true });
    }
  });
});
