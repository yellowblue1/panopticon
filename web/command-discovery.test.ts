import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverAllSlashCommands, discoverSlashCommands } from "./command-discovery";

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
});
