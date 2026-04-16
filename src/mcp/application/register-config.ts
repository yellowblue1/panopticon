import type { McpConfigDeps } from "../domain/ports";

/**
 * Auto-register the Panopticon MCP endpoint in ~/.claude.json (user-scoped mcpServers).
 * Always uses localhost since the server guarantees a localhost listener is available
 * (either as the primary bind address or via the dual-listen mirror).
 * Also migrates any stale entry from the old ~/.claude/.mcp.json location.
 *
 * @returns `true` if the config was written (new or updated), `false` if already up-to-date.
 */
export function registerMcpConfig(port: number, deps: McpConfigDeps): boolean {
  migrateOldConfig(deps);

  let config: Record<string, unknown> = {};
  const raw = deps.readFile(deps.claudeJsonPath);
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        // Valid JSON but not a plain object — abort to avoid data loss
        return false;
      }
      config = parsed as Record<string, unknown>;
    } catch {
      // Invalid JSON — abort to avoid corrupting the user's config
      return false;
    }
  }

  let mcpServers: Record<string, unknown>;
  if (
    typeof config.mcpServers === "object" &&
    config.mcpServers !== null &&
    !Array.isArray(config.mcpServers)
  ) {
    mcpServers = config.mcpServers as Record<string, unknown>;
  } else {
    mcpServers = {};
  }

  const expectedUrl = `http://localhost:${port}/mcp`;

  if ("panopticon" in mcpServers) {
    // Update URL if port changed
    const existing = mcpServers.panopticon as Record<string, unknown> | undefined;
    if (existing?.url === expectedUrl) return false;
  }

  mcpServers.panopticon = {
    type: "http",
    url: expectedUrl,
  };
  config.mcpServers = mcpServers;

  deps.writeFile(deps.claudeJsonPath, `${JSON.stringify(config, null, 2)}\n`);
  return true;
}

/** Remove stale "panopticon" entry from ~/.claude/.mcp.json (the old, incorrect path). */
function migrateOldConfig(deps: McpConfigDeps): void {
  if (!deps.fileExists(deps.oldMcpJsonPath)) return;

  const raw = deps.readFile(deps.oldMcpJsonPath);
  if (raw === null) return;

  let config: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
    config = parsed as Record<string, unknown>;
  } catch {
    return;
  }

  const { mcpServers } = config;
  if (typeof mcpServers !== "object" || mcpServers === null || Array.isArray(mcpServers)) return;

  const servers = mcpServers as Record<string, unknown>;
  if (!("panopticon" in servers)) return;

  delete servers.panopticon;

  if (Object.keys(servers).length === 0) {
    delete config.mcpServers;
  }

  if (Object.keys(config).length === 0) {
    deps.removeFile(deps.oldMcpJsonPath);
  } else {
    deps.writeFile(deps.oldMcpJsonPath, `${JSON.stringify(config, null, 2)}\n`);
  }
}
