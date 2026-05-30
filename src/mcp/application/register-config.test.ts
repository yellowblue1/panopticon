import { describe, expect, it } from "bun:test";
import type { McpConfigDeps } from "../domain/ports";
import {
  PANE_ID_HEADER_NAME,
  PANE_ID_HEADER_VALUE_TEMPLATE,
  registerMcpConfig,
  resolveMcpConnectHost,
} from "./register-config";

const expectedHeaders = { [PANE_ID_HEADER_NAME]: PANE_ID_HEADER_VALUE_TEMPLATE };

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

    const result = registerMcpConfig(3847, "localhost", deps);

    expect(result).toBe(true);
    const written = readJson(deps.files, deps.claudeJsonPath);
    expect((written.mcpServers as Record<string, unknown>).panopticon).toEqual({
      type: "http",
      url: "http://localhost:3847/mcp",
      headers: expectedHeaders,
    });
  });

  it("adds mcpServers to existing file without the key", () => {
    const deps = createMockDeps({
      "/home/test/.claude.json": JSON.stringify({ theme: "dark", numStartups: 5 }),
    });

    const result = registerMcpConfig(3847, "localhost", deps);

    expect(result).toBe(true);
    const written = readJson(deps.files, deps.claudeJsonPath);
    expect(written.theme).toBe("dark");
    expect(written.numStartups).toBe(5);
    const servers = written.mcpServers as Record<string, Record<string, unknown>>;
    expect(servers.panopticon.type).toBe("http");
    expect(servers.panopticon.headers).toEqual(expectedHeaders);
  });

  it("adds panopticon alongside existing MCP servers", () => {
    const existing = {
      mcpServers: { other: { type: "stdio", command: "node" } },
    };
    const deps = createMockDeps({
      "/home/test/.claude.json": JSON.stringify(existing),
    });

    const result = registerMcpConfig(4000, "localhost", deps);

    expect(result).toBe(true);
    const written = readJson(deps.files, deps.claudeJsonPath);
    const servers = written.mcpServers as Record<string, Record<string, unknown>>;
    expect(servers.other).toEqual({ type: "stdio", command: "node" });
    expect(servers.panopticon.url).toBe("http://localhost:4000/mcp");
  });

  it("skips registration when panopticon URL and headers already match", () => {
    const existing = {
      mcpServers: {
        panopticon: {
          type: "http",
          url: "http://localhost:3847/mcp",
          headers: expectedHeaders,
        },
      },
    };
    const deps = createMockDeps({
      "/home/test/.claude.json": JSON.stringify(existing),
    });

    const result = registerMcpConfig(3847, "localhost", deps);

    expect(result).toBe(false);
  });

  it("rewrites a legacy panopticon entry that lacks the headers field", () => {
    const existing = {
      mcpServers: { panopticon: { type: "http", url: "http://localhost:3847/mcp" } },
    };
    const deps = createMockDeps({
      "/home/test/.claude.json": JSON.stringify(existing),
    });

    const result = registerMcpConfig(3847, "localhost", deps);

    expect(result).toBe(true);
    const written = readJson(deps.files, deps.claudeJsonPath);
    const servers = written.mcpServers as Record<string, Record<string, unknown>>;
    expect(servers.panopticon.headers).toEqual(expectedHeaders);
  });

  it("updates URL when hostname changes", () => {
    const existing = {
      mcpServers: {
        panopticon: {
          type: "http",
          url: "http://localhost:3847/mcp",
          headers: expectedHeaders,
        },
      },
    };
    const deps = createMockDeps({
      "/home/test/.claude.json": JSON.stringify(existing),
    });

    const result = registerMcpConfig(3847, "192.168.1.100", deps);

    expect(result).toBe(true);
    const written = readJson(deps.files, deps.claudeJsonPath);
    const servers = written.mcpServers as Record<string, Record<string, unknown>>;
    expect(servers.panopticon.url).toBe("http://192.168.1.100:3847/mcp");
  });

  it("aborts without writing when ~/.claude.json contains invalid JSON", () => {
    const deps = createMockDeps({
      "/home/test/.claude.json": "not valid json{",
    });

    const result = registerMcpConfig(3847, "localhost", deps);

    expect(result).toBe(false);
    expect(deps.files.get(deps.claudeJsonPath)).toBe("not valid json{");
  });

  it("aborts without writing when ~/.claude.json root is an array", () => {
    const deps = createMockDeps({
      "/home/test/.claude.json": "[1, 2, 3]",
    });

    const result = registerMcpConfig(3847, "localhost", deps);

    expect(result).toBe(false);
    expect(deps.files.get(deps.claudeJsonPath)).toBe("[1, 2, 3]");
  });

  it("reflects the given port in the URL", () => {
    const deps = createMockDeps();

    registerMcpConfig(8080, "localhost", deps);

    const written = readJson(deps.files, deps.claudeJsonPath);
    const servers = written.mcpServers as Record<string, Record<string, unknown>>;
    expect(servers.panopticon.url).toBe("http://localhost:8080/mcp");
  });

  it("reflects the given hostname in the URL", () => {
    const deps = createMockDeps();

    registerMcpConfig(3847, "192.168.1.100", deps);

    const written = readJson(deps.files, deps.claudeJsonPath);
    const servers = written.mcpServers as Record<string, Record<string, unknown>>;
    expect(servers.panopticon.url).toBe("http://192.168.1.100:3847/mcp");
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

    registerMcpConfig(3847, "localhost", deps);

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

    registerMcpConfig(3847, "localhost", deps);

    expect(deps.files.has(deps.oldMcpJsonPath)).toBe(false);
  });

  it("does not fail when old file does not exist", () => {
    const deps = createMockDeps();

    expect(() => registerMcpConfig(3847, "localhost", deps)).not.toThrow();
    expect(registerMcpConfig(3847, "localhost", deps)).toBe(false); // second call — already registered
  });
});

describe("resolveMcpConnectHost", () => {
  it("maps the IPv4 wildcard to localhost", () => {
    expect(resolveMcpConnectHost("0.0.0.0")).toBe("localhost");
  });

  it("maps the IPv6 wildcard to localhost", () => {
    expect(resolveMcpConnectHost("::")).toBe("localhost");
  });

  it("passes through a concrete IPv4 host unchanged", () => {
    expect(resolveMcpConnectHost("100.105.121.19")).toBe("100.105.121.19");
  });

  it("passes through localhost unchanged", () => {
    expect(resolveMcpConnectHost("localhost")).toBe("localhost");
  });

  it("brackets a bare IPv6 literal so the URL stays well-formed", () => {
    expect(resolveMcpConnectHost("::1")).toBe("[::1]");
    expect(resolveMcpConnectHost("fd7a::5")).toBe("[fd7a::5]");
  });

  it("does not double-bracket an already-bracketed IPv6 literal", () => {
    expect(resolveMcpConnectHost("[fd7a::5]")).toBe("[fd7a::5]");
  });
});

describe("registerMcpConfig with IPv6 hostnames", () => {
  it("writes a bracketed IPv6 URL for a bare IPv6 bind hostname", () => {
    const deps = createMockDeps();
    registerMcpConfig(3848, "::1", deps);
    const config = readJson(deps.files, "/home/test/.claude.json");
    const servers = config.mcpServers as Record<string, { url: string }>;
    expect(servers.panopticon.url).toBe("http://[::1]:3848/mcp");
  });
});
