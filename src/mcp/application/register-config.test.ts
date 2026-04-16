import { describe, expect, it } from "bun:test";
import type { McpConfigDeps } from "../domain/ports";
import { registerMcpConfig } from "./register-config";

function createMockDeps(
  files: Record<string, string> = {},
): McpConfigDeps & { files: Map<string, string> } {
  const store = new Map(Object.entries(files));
  return {
    files: store,
    readFile: (path) => store.get(path) ?? null,
    writeFile: (path, content) => store.set(path, content),
    removeFile: (path) => store.delete(path),
    fileExists: (path) => store.has(path),
    claudeJsonPath: "/home/test/.claude.json",
    oldMcpJsonPath: "/home/test/.claude/.mcp.json",
  };
}

function readJson(store: Map<string, string>, key: string): Record<string, unknown> {
  const raw = store.get(key);
  if (raw === undefined) throw new Error(`Key not found: ${key}`);
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("registerMcpConfig", () => {
  it("creates ~/.claude.json when it does not exist", () => {
    const deps = createMockDeps();

    const result = registerMcpConfig(3847, deps);

    expect(result).toBe(true);
    const written = readJson(deps.files, deps.claudeJsonPath);
    expect((written.mcpServers as Record<string, unknown>).panopticon).toEqual({
      type: "http",
      url: "http://localhost:3847/mcp",
    });
  });

  it("adds mcpServers to existing file without the key", () => {
    const deps = createMockDeps({
      "/home/test/.claude.json": JSON.stringify({ theme: "dark", numStartups: 5 }),
    });

    const result = registerMcpConfig(3847, deps);

    expect(result).toBe(true);
    const written = readJson(deps.files, deps.claudeJsonPath);
    expect(written.theme).toBe("dark");
    expect(written.numStartups).toBe(5);
    const servers = written.mcpServers as Record<string, Record<string, unknown>>;
    expect(servers.panopticon.type).toBe("http");
  });

  it("adds panopticon alongside existing MCP servers", () => {
    const existing = {
      mcpServers: { other: { type: "stdio", command: "node" } },
    };
    const deps = createMockDeps({
      "/home/test/.claude.json": JSON.stringify(existing),
    });

    const result = registerMcpConfig(4000, deps);

    expect(result).toBe(true);
    const written = readJson(deps.files, deps.claudeJsonPath);
    const servers = written.mcpServers as Record<string, Record<string, unknown>>;
    expect(servers.other).toEqual({ type: "stdio", command: "node" });
    expect(servers.panopticon.url).toBe("http://localhost:4000/mcp");
  });

  it("skips registration when panopticon URL already matches", () => {
    const existing = {
      mcpServers: { panopticon: { type: "http", url: "http://localhost:3847/mcp" } },
    };
    const deps = createMockDeps({
      "/home/test/.claude.json": JSON.stringify(existing),
    });

    const result = registerMcpConfig(3847, deps);

    expect(result).toBe(false);
  });

  it("updates URL when port changes", () => {
    const existing = {
      mcpServers: { panopticon: { type: "http", url: "http://localhost:3847/mcp" } },
    };
    const deps = createMockDeps({
      "/home/test/.claude.json": JSON.stringify(existing),
    });

    const result = registerMcpConfig(4000, deps);

    expect(result).toBe(true);
    const written = readJson(deps.files, deps.claudeJsonPath);
    const servers = written.mcpServers as Record<string, Record<string, unknown>>;
    expect(servers.panopticon.url).toBe("http://localhost:4000/mcp");
  });

  it("aborts without writing when ~/.claude.json contains invalid JSON", () => {
    const deps = createMockDeps({
      "/home/test/.claude.json": "not valid json{",
    });

    const result = registerMcpConfig(3847, deps);

    expect(result).toBe(false);
    expect(deps.files.get(deps.claudeJsonPath)).toBe("not valid json{");
  });

  it("aborts without writing when ~/.claude.json root is an array", () => {
    const deps = createMockDeps({
      "/home/test/.claude.json": "[1, 2, 3]",
    });

    const result = registerMcpConfig(3847, deps);

    expect(result).toBe(false);
    expect(deps.files.get(deps.claudeJsonPath)).toBe("[1, 2, 3]");
  });

  it("reflects the given port in the URL", () => {
    const deps = createMockDeps();

    registerMcpConfig(8080, deps);

    const written = readJson(deps.files, deps.claudeJsonPath);
    const servers = written.mcpServers as Record<string, Record<string, unknown>>;
    expect(servers.panopticon.url).toBe("http://localhost:8080/mcp");
  });

  it("always uses localhost in the URL", () => {
    const deps = createMockDeps();

    registerMcpConfig(3847, deps);

    const written = readJson(deps.files, deps.claudeJsonPath);
    const servers = written.mcpServers as Record<string, Record<string, unknown>>;
    expect(servers.panopticon.url).toBe("http://localhost:3847/mcp");
  });

  it("migrates panopticon entry from old ~/.claude/.mcp.json", () => {
    const oldConfig = {
      mcpServers: {
        panopticon: { type: "http", url: "http://localhost:3848/mcp" },
        other: { type: "stdio", command: "node" },
      },
    };
    const deps = createMockDeps({
      "/home/test/.claude/.mcp.json": JSON.stringify(oldConfig),
    });

    registerMcpConfig(3847, deps);

    const oldWritten = readJson(deps.files, deps.oldMcpJsonPath);
    const oldServers = oldWritten.mcpServers as Record<string, unknown>;
    expect(oldServers.other).toEqual({ type: "stdio", command: "node" });
    expect(oldServers.panopticon).toBeUndefined();

    const newWritten = readJson(deps.files, deps.claudeJsonPath);
    const newServers = newWritten.mcpServers as Record<string, Record<string, unknown>>;
    expect(newServers.panopticon.url).toBe("http://localhost:3847/mcp");
  });

  it("deletes old file when panopticon was the only entry", () => {
    const oldConfig = {
      mcpServers: { panopticon: { type: "http", url: "http://localhost:3848/mcp" } },
    };
    const deps = createMockDeps({
      "/home/test/.claude/.mcp.json": JSON.stringify(oldConfig),
    });

    registerMcpConfig(3847, deps);

    expect(deps.files.has(deps.oldMcpJsonPath)).toBe(false);
  });

  it("does not fail when old file does not exist", () => {
    const deps = createMockDeps();

    expect(() => registerMcpConfig(3847, deps)).not.toThrow();
    expect(registerMcpConfig(3847, deps)).toBe(false); // second call — already registered
  });
});
