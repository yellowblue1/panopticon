import type { McpConfigDeps } from "../domain/ports";

/**
 * Map a server bind hostname to the host clients should connect on.
 * Wildcard binds (`0.0.0.0`, `::`) are not valid as a connect target —
 * loopback is the safe substitute. Exported so the MCP host allowlist
 * in the HTTP layer can stay in lockstep with the URL registered here.
 */
export function resolveMcpConnectHost(hostname: string): string {
  return hostname === "0.0.0.0" || hostname === "::" ? "localhost" : hostname;
}

/**
 * Header name the MCP server reads to identify the calling tmux pane.
 */
export const PANE_ID_HEADER_NAME = "X-Panopticon-Pane-Id";

/**
 * Header value written to the MCP config. Claude Code interpolates `${TMUX_PANE}`
 * at request time, so the server receives the caller's actual pane id (e.g. `%42`).
 */
// biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder that Claude Code interpolates at runtime
export const PANE_ID_HEADER_VALUE_TEMPLATE = "${TMUX_PANE}";

/**
 * Auto-register the Panopticon MCP endpoint in ~/.claude.json (user-scoped mcpServers).
 * Creates a new entry or updates the URL if hostname/port changed.
 * Also migrates any stale entry from the old ~/.claude/.mcp.json location.
 *
 * @returns `true` if the config was written (new or updated), `false` if already up-to-date.
 */
export function registerMcpConfig(port: number, hostname: string, deps: McpConfigDeps): boolean {
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

  const expectedUrl = `http://${resolveMcpConnectHost(hostname)}:${port}/mcp`;
  const expectedHeaders = { [PANE_ID_HEADER_NAME]: PANE_ID_HEADER_VALUE_TEMPLATE };

  if ("panopticon" in mcpServers) {
    const existing = mcpServers.panopticon as { url?: unknown; headers?: unknown } | undefined;
    const headers = existing?.headers;
    const headersMatch =
      typeof headers === "object" &&
      headers !== null &&
      !Array.isArray(headers) &&
      (headers as Record<string, unknown>)[PANE_ID_HEADER_NAME] === PANE_ID_HEADER_VALUE_TEMPLATE;
    if (existing?.url === expectedUrl && headersMatch) return false;
  }

  mcpServers.panopticon = {
    type: "http",
    url: expectedUrl,
    headers: expectedHeaders,
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
