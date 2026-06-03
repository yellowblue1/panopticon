import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { serveStatic } from "hono/bun";
import { z } from "zod";
import { generatePaneSummary } from "../src/intelligence/application/summarize";
import type { SummaryDeps } from "../src/intelligence/domain/ports";
import { hasAuthError } from "../src/intelligence/infrastructure/auth-error-state";
import { TtlCache } from "../src/intelligence/infrastructure/cache";
import { createGenerateContentFn } from "../src/intelligence/infrastructure/gemini-client";
import { bootstrapGeminiEnv } from "../src/intelligence/infrastructure/gemini-config";
import { createSqliteCacheStore } from "../src/intelligence/infrastructure/sqlite-cache-store";
import { browsePath as browsePathFn } from "../src/launcher/application/browse-path";
import { discoverProjects } from "../src/launcher/application/discover-projects";
import { generateSessionName, launchSession } from "../src/launcher/application/launch-session";
import { getLauncherConfig, updateLauncherConfig } from "../src/launcher/application/manage-config";
import { createLauncherDeps } from "../src/launcher/infrastructure/fs-operations";
import { handleFilePush } from "../src/mcp/application/handle-file-push";
import { handleUrlPush } from "../src/mcp/application/handle-url-push";
import {
  PANE_ID_HEADER_NAME,
  PANE_ID_HEADER_VALUE_TEMPLATE,
  registerMcpConfig,
  resolveMcpConnectHost,
} from "../src/mcp/application/register-config";
import type { McpFilePushDeps, McpUrlPushDeps } from "../src/mcp/domain/ports";
import {
  deletePlan,
  findSlugForCwd,
  planFileExists,
  readPlanContent,
} from "../src/plan/application/discover-plan";
import { createPlanDiscoveryDeps } from "../src/plan/infrastructure/file-operations";
import { SessionManager } from "../src/session/application/session-manager";
import type { SessionManagerDeps } from "../src/session/domain/ports";
import { defaultCreateFifo, defaultSpawnFifoReader } from "../src/session/infrastructure/fifo";
import { computeLineDiff, isDiffWorthSending } from "../src/shared/pane-diff";
import type {
  FilePushSseEvent,
  PaneContentDiff,
  PaneContentFull,
  UrlPushSseEvent,
} from "../src/shared/types";
import { sendMessage } from "../src/terminal/application/send-message";
import { createFileUploadDeps } from "../src/terminal/infrastructure/file-upload";
import {
  buildTmuxTarget,
  getMonitoredProcesses,
  matchProcessesToPanes,
} from "../src/terminal/infrastructure/process-matching";
import {
  capturePaneContent,
  capturePaneContentEscaped,
  capturePaneContentSanitized,
  getAllTmuxPanes,
  getGitBranch,
  getGitRemoteUrl,
  getProcessCwd,
  getProcessStartTime,
  getProcessTable,
  getProjectName,
  isTmuxAvailable,
  pastePath,
  sendEnter,
  sendInterrupt,
  sendKeys,
  sendLiteral,
  sendRawKey,
  startPipePane,
  stopPipePane,
  switchClient,
} from "../src/terminal/infrastructure/tmux-commands";
import { BuiltinCommandProvider } from "./builtin-command-fetcher";
import { discoverAllSlashCommands } from "./command-discovery";
import { type AppType, createApp, type SseClient } from "./server-app";

const DEFAULT_PORT = 3847;
const DEFAULT_HOST = "127.0.0.1";
const PORT = process.env.PORT
  ? Number.parseInt(process.env.PORT, 10)
  : process.env.DEV_PORT
    ? Number.parseInt(process.env.DEV_PORT, 10) + 1
    : DEFAULT_PORT;
const HOST = process.env.HOST ?? DEFAULT_HOST;

// ═══ Builtin command fetcher ═══

const CACHE_DIR = join(homedir(), ".cache", "panopticon");

const builtinCommandProvider = new BuiltinCommandProvider({
  fetchText: async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return res.text();
  },
  readFileSync: (path) => readFileSync(path, "utf-8"),
  writeFileSync: (path, data) => writeFileSync(path, data, "utf-8"),
  existsSync,
  mkdirSync: (path) => mkdirSync(path, { recursive: true }),
  cacheDir: CACHE_DIR,
});

// ═══ Wire dependencies ═══

const geminiBackend = bootstrapGeminiEnv();

// Create generateContent function for summaries (only if Gemini is configured)
const summaryGenerateContent = geminiBackend ? createGenerateContentFn("gemini-2.5-flash") : null;

const summaryCache = new TtlCache<string>({
  store: createSqliteCacheStore<string>({ tableName: "summaries" }),
  tag: "Gemini Summary",
});

const summaryDeps: SummaryDeps = {
  generateContent: summaryGenerateContent ?? (async () => null),
  cache: summaryCache,
};

const sessionManagerDeps: SessionManagerDeps = {
  isTmuxAvailable,
  getAllTmuxPanes,
  getProcessTable,
  getMonitoredProcesses,
  getProcessCwd,
  getProcessStartTime,
  getProjectName,
  getGitBranch,
  getGitRemoteUrl,
  buildTmuxTarget,
  matchProcessesToPanes,
  generateSummary: (content) => generatePaneSummary(content, summaryDeps),
  isAuthError: hasAuthError,
  capturePaneContent,
  capturePaneContentForSummary: capturePaneContentSanitized,
  startPipePane,
  stopPipePane,
  createFifo: defaultCreateFifo,
  spawnFifoReader: defaultSpawnFifoReader,
};

// Shared encoder for SSE message serialization
const encoder = new TextEncoder();

// SSE clients (session list)
const clients: Set<SseClient> = new Set();

// SSE heartbeat to prevent Bun idleTimeout (255s) from closing idle connections
// and to detect dead clients early. Sends a data message every 30s so clients
// can track connection health and reconnect if messages stop arriving.
const SSE_HEARTBEAT_INTERVAL_MS = 30_000;
const heartbeatMessage = encoder.encode(`data: {"type":"heartbeat"}\n\n`);

setInterval(() => {
  for (const client of clients) {
    try {
      client.controller.enqueue(heartbeatMessage);
    } catch {
      clients.delete(client);
    }
  }
}, SSE_HEARTBEAT_INTERVAL_MS);

// SSE clients (pane content — per-pane)
const paneContentClients = new Map<string, Set<SseClient>>();
const paneContentDebounce = new Map<string, ReturnType<typeof setTimeout>>();
const paneContentHashes = new Map<string, string>();
const PANE_CONTENT_DEBOUNCE_MS = 75;

// Diff state for bandwidth optimization
const paneContentPrev = new Map<string, string>();
const paneContentSeq = new Map<string, number>();
const paneContentUpdateCount = new Map<string, number>();
const FULL_SYNC_INTERVAL = 20;

function makeFullPayload(paneId: string, content: string, seq: number): PaneContentFull {
  return { type: "full", pane_id: paneId, content, timestamp: Date.now(), seq };
}

// Session manager with tmux polling
const sessionManager = new SessionManager(sessionManagerDeps);

// Launcher (project discovery + session launch)
const launcherDeps = createLauncherDeps({
  getProjectName,
  getGitBranch,
  getGitRemoteUrl,
});

// File upload (temp directory for image/PDF uploads)
const fileUploadDeps = createFileUploadDeps();
setInterval(() => fileUploadDeps.cleanup(), 30 * 60 * 1000);

// Plan discovery (slug cache: cwd → slug, stable per session lifetime)
const planDeps = createPlanDiscoveryDeps();
const slugCache = new Map<string, string | null>();

function serializeSessionsData(): string {
  return JSON.stringify({
    sessions: sessionManager.getSessions(),
    timestamp: Date.now(),
  });
}

function broadcastUpdate() {
  const data = serializeSessionsData();
  const message = `data: ${data}\n\n`;

  for (const client of clients) {
    try {
      client.controller.enqueue(encoder.encode(message));
    } catch {
      clients.delete(client);
    }
  }
}

// ═══ MCP config ═══

const MCP_ENABLED = process.env.PANOPTICON_MCP?.toLowerCase() !== "false";

// ═══ MCP server ═══

function broadcastSseEvent(event: FilePushSseEvent | UrlPushSseEvent): void {
  const data = encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
  for (const client of clients) {
    try {
      client.controller.enqueue(data);
    } catch {
      clients.delete(client);
    }
  }
}

const mcpUrlPushDeps: McpUrlPushDeps = {
  broadcastUrlPush: broadcastSseEvent,
};

const mcpFilePushDeps: McpFilePushDeps = {
  readFile: (path) => {
    try {
      return Buffer.from(readFileSync(path));
    } catch {
      return null;
    }
  },
  getFileSize: (path) => {
    try {
      return statSync(path).size;
    } catch {
      return -1;
    }
  },
  broadcastFilePush: broadcastSseEvent,
};

const mcpServer = new McpServer({
  name: "panopticon",
  version: "0.1.0",
});

const mcpTransport = new StreamableHTTPTransport({ sessionIdGenerator: undefined });

// Hono lowercases all request header keys (WHATWG Headers).
const PANE_ID_HEADER_NAME_LC = PANE_ID_HEADER_NAME.toLowerCase();

// Identify the calling tmux pane from the request header. Claude Code interpolates
// ${TMUX_PANE} at request time, so a missing value (or the literal placeholder,
// which indicates TMUX_PANE was unset at the caller) means the client is not
// running inside tmux.
function resolvePaneId(
  headers: Record<string, string | string[] | undefined> | undefined,
): string | null {
  const raw = headers?.[PANE_ID_HEADER_NAME_LC];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  if (value === PANE_ID_HEADER_VALUE_TEMPLATE || value.trim() === "") return null;
  return value;
}

const MISSING_PANE_ID_ERROR = `${PANE_ID_HEADER_NAME} header is missing. This tool must be called from a Claude Code session launched inside tmux.`;

function missingPaneIdResponse() {
  return {
    content: [{ type: "text" as const, text: `Error: ${MISSING_PANE_ID_ERROR}` }],
    isError: true,
  };
}

mcpServer.tool(
  "push_file",
  "Push a file to the Panopticon browser dashboard for display or download",
  {
    file_path: z.string().describe("Absolute path to the file to push"),
    filename: z.string().optional().describe("Display name for the file (defaults to basename)"),
  },
  async ({ file_path, filename }, extra) => {
    const paneId = resolvePaneId(extra.requestInfo?.headers);
    if (!paneId) return missingPaneIdResponse();

    const result = handleFilePush(
      { filePath: file_path, sessionId: paneId, filename },
      mcpFilePushDeps,
    );

    if (!result.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Pushed ${result.filename} (${result.mimeType}, ${result.size} bytes) to dashboard`,
        },
      ],
    };
  },
);

mcpServer.tool(
  "push_url",
  "Push a URL to the Panopticon browser dashboard so the user can open it with a single click",
  {
    url: z.string().describe("The URL to push (http or https)"),
    label: z.string().optional().describe("Display label for the URL (defaults to the URL itself)"),
  },
  async ({ url, label }, extra) => {
    const paneId = resolvePaneId(extra.requestInfo?.headers);
    if (!paneId) return missingPaneIdResponse();

    const result = handleUrlPush({ url, label, sessionId: paneId }, mcpUrlPushDeps);

    if (!result.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Pushed URL to dashboard: ${result.url}`,
        },
      ],
    };
  },
);

// Broadcast when session state changes
sessionManager.onChange(() => {
  broadcastUpdate();

  // Clean stale slug cache entries for removed sessions
  const activeCwds = new Set<string>();
  for (const session of sessionManager.getSessions()) {
    const cwd = sessionManager.getSessionCwd(session.pane_id);
    if (cwd) activeCwds.add(cwd);
  }
  for (const cwd of slugCache.keys()) {
    if (!activeCwds.has(cwd)) slugCache.delete(cwd);
  }
});

// Debounced pane content push via SSE (with diff optimization)
sessionManager.onPaneActivity((paneId) => {
  const watchers = paneContentClients.get(paneId);
  if (!watchers || watchers.size === 0) return;

  // Reset debounce timer
  const existing = paneContentDebounce.get(paneId);
  if (existing) clearTimeout(existing);

  paneContentDebounce.set(
    paneId,
    setTimeout(() => {
      paneContentDebounce.delete(paneId);

      const content = capturePaneContentEscaped(paneId);
      if (content === null) return;

      // Hash guard — skip if content unchanged
      const hash = Bun.hash(content).toString();
      if (paneContentHashes.get(paneId) === hash) return;
      paneContentHashes.set(paneId, hash);

      // Increment sequence number
      const seq = (paneContentSeq.get(paneId) ?? 0) + 1;
      paneContentSeq.set(paneId, seq);

      // Periodic full sync to prevent drift
      const updateCount = (paneContentUpdateCount.get(paneId) ?? 0) + 1;
      paneContentUpdateCount.set(paneId, updateCount);
      const forceFullSync = updateCount % FULL_SYNC_INTERVAL === 0;

      const prevContent = paneContentPrev.get(paneId);
      let message: string;

      if (!forceFullSync && prevContent !== undefined) {
        const diff = computeLineDiff(prevContent, content);
        if (diff === null) return; // identical (safety after hash guard)

        if (isDiffWorthSending(content.length, diff.lines)) {
          const payload: PaneContentDiff = {
            type: "diff",
            pane_id: paneId,
            lines: diff.lines,
            lineCount: diff.lineCount,
            timestamp: Date.now(),
            seq,
          };
          message = `data: ${JSON.stringify(payload)}\n\n`;
        } else {
          message = `data: ${JSON.stringify(makeFullPayload(paneId, content, seq))}\n\n`;
        }
      } else {
        message = `data: ${JSON.stringify(makeFullPayload(paneId, content, seq))}\n\n`;
        if (forceFullSync) {
          paneContentUpdateCount.set(paneId, 0);
        }
      }

      // Store current content for next diff
      paneContentPrev.set(paneId, content);

      // Push to watching clients
      const encoded = encoder.encode(message);
      const currentWatchers = paneContentClients.get(paneId);
      if (!currentWatchers) return;

      for (const client of currentWatchers) {
        try {
          client.controller.enqueue(encoded);
        } catch {
          currentWatchers.delete(client);
        }
      }
    }, PANE_CONTENT_DEBOUNCE_MS),
  );
});

// Check if a panopticon server is already running on the port
async function isOurServerRunning(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/api/sessions`, {
      signal: AbortSignal.timeout(1000),
    });
    if (response.ok) {
      const data = await response.json();
      return "sessions" in data && "timestamp" in data;
    }
  } catch {
    // Connection failed or timeout - server not running
  }
  return false;
}

// Create Hono app with dependencies
const app = createApp(
  {
    getSessions: () => sessionManager.getSessions(),
    sendKeys: (paneId, text) => sendKeys(paneId, text),
    sendRawKey: (paneId, key) => sendRawKey(paneId, key),
    switchClient: (paneId) => switchClient(paneId),
    sendInterrupt: (paneId) => sendInterrupt(paneId),
    sendMessage: (paneId, text, files) =>
      sendMessage(
        { paneId, text, files },
        {
          pastePath: (pid, content) => pastePath(pid, content),
          sendLiteral: (pid, txt) => sendLiteral(pid, txt),
          sendEnter: (pid) => sendEnter(pid),
          saveFile: fileUploadDeps.saveFile,
          sleep: (ms) => Bun.sleep(ms),
        },
      ),
    // Uses escaped variant to preserve ANSI codes for xterm.js rendering
    capturePaneContent: capturePaneContentEscaped,
    geminiBackend,
    isAiAvailable: geminiBackend !== null,
    getGeminiAuthError: hasAuthError,
    getPlan: (paneId) => {
      const cwd = sessionManager.getSessionCwd(paneId);
      if (!cwd) return null;

      // Reuse slug cache to avoid re-reading JSONL files
      const slug = slugCache.getOrInsertComputed(cwd, (key) => findSlugForCwd(key, planDeps));
      if (!slug) return null;

      const content = readPlanContent(slug, planDeps);
      if (!content) return null;
      return { slug, content };
    },
    getPlansAvailability: () => {
      const result: Record<string, boolean> = {};
      for (const session of sessionManager.getSessions()) {
        const cwd = sessionManager.getSessionCwd(session.pane_id);
        if (!cwd) {
          result[session.pane_id] = false;
          continue;
        }
        const slug = slugCache.getOrInsertComputed(cwd, (key) => findSlugForCwd(key, planDeps));
        if (!slug) {
          result[session.pane_id] = false;
          continue;
        }
        result[session.pane_id] = planFileExists(slug, planDeps);
      }
      return result;
    },
    deletePlan: (paneId) => {
      const cwd = sessionManager.getSessionCwd(paneId);
      if (!cwd) return false;

      const slug = slugCache.getOrInsertComputed(cwd, (key) => findSlugForCwd(key, planDeps));
      if (!slug) return false;

      const success = deletePlan(slug, planDeps);
      if (success) {
        slugCache.delete(cwd);
      }
      return success;
    },
    getBuiltinCommands: () => builtinCommandProvider.getCommands(),
    discoverProjects: () =>
      discoverProjects(launcherDeps).map((p) => ({
        name: p.name,
        path: p.path,
        gitBranch: p.gitBranch,
        gitRemoteUrl: p.gitRemoteUrl,
      })),
    launchSession: (config) => {
      const sessionName =
        config.sessionName ?? generateSessionName(config.projectPath, config.agentType);
      const result = launchSession({ ...config, sessionName }, launcherDeps);
      return {
        success: result.success,
        sessionName: result.sessionName,
        paneId: result.paneId,
        error: result.error,
      };
    },
    getLauncherConfig: () => {
      const config = getLauncherConfig(launcherDeps);
      return { scanPaths: config.scanPaths, useGhq: config.useGhq };
    },
    setLauncherConfig: (config) => {
      const updated = updateLauncherConfig(config, launcherDeps);
      return { scanPaths: updated.scanPaths, useGhq: updated.useGhq };
    },
    browsePath: (path) => browsePathFn(path, launcherDeps),
    handleMcpRequest: MCP_ENABLED
      ? async (c) => {
          if (!mcpServer.isConnected()) {
            await mcpServer.connect(mcpTransport);
          }
          return (
            (await mcpTransport.handleRequest(c)) ??
            new Response("No response from MCP server", { status: 500 })
          );
        }
      : undefined,
    discoverSlashCommands: () => {
      const cwds: string[] = [];
      for (const session of sessionManager.getSessions()) {
        const cwd = sessionManager.getSessionCwd(session.pane_id);
        if (cwd) cwds.push(cwd);
      }
      return discoverAllSlashCommands(cwds);
    },
    onSseConnect: (client) => {
      clients.add(client);
    },
    onSseDisconnect: (client) => {
      clients.delete(client);
    },
    serializeSessionsData,
    onPaneContentSseConnect: (paneId, client) => {
      if (!paneContentClients.has(paneId)) {
        paneContentClients.set(paneId, new Set());
      }
      paneContentClients.get(paneId)?.add(client);

      // Store initial content so the first onPaneActivity can compute a diff
      // instead of falling back to full sync
      const initialContent = capturePaneContentEscaped(paneId);
      if (initialContent !== null) {
        paneContentPrev.set(paneId, initialContent);
        paneContentHashes.set(paneId, Bun.hash(initialContent).toString());
      }
    },
    onPaneContentSseDisconnect: (paneId, client) => {
      const watchers = paneContentClients.get(paneId);
      if (watchers) {
        watchers.delete(client);
        if (watchers.size === 0) {
          paneContentClients.delete(paneId);
          // Clean up all per-pane state when no watchers
          const timer = paneContentDebounce.get(paneId);
          if (timer) {
            clearTimeout(timer);
            paneContentDebounce.delete(paneId);
          }
          paneContentHashes.delete(paneId);
          paneContentPrev.delete(paneId);
          paneContentSeq.delete(paneId);
          paneContentUpdateCount.delete(paneId);
        }
      }
    },
  },
  { restrictCors: true, mcpAllowedHost: resolveMcpConnectHost(HOST) },
);

// Add static file serving and SPA fallback (only when dist/ exists)
const distDir = join(import.meta.dirname, "dist");
const distIndexPath = join(distDir, "index.html");

let appWithStatic: typeof app;
if (existsSync(distIndexPath)) {
  const indexHtml = readFileSync(distIndexPath);
  appWithStatic = app.use("/*", serveStatic({ root: distDir })).get("/*", (c) => {
    return c.body(indexHtml, 200, {
      "Content-Type": "text/html; charset=utf-8",
    });
  });
} else {
  appWithStatic = app;
}

// Export type for future RPC client
export type { AppType };

// Main startup
async function main() {
  // Check if our server is already running on the target port
  if (await isOurServerRunning(PORT)) {
    console.log(`Panopticon Web UI already running at http://localhost:${PORT}`);
    process.exit(0);
  }

  // Start server
  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      port: PORT,
      hostname: HOST,
      fetch: appWithStatic.fetch,
      idleTimeout: 255,
    });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === "EADDRINUSE") {
      console.error(`Port ${PORT} is in use by another application`);
      server = Bun.serve({
        port: 0,
        hostname: HOST,
        fetch: appWithStatic.fetch,
        idleTimeout: 255,
      });
    } else {
      throw err;
    }
  }

  console.log(`Panopticon Web UI running at http://${server.hostname}:${server.port}`);

  // Auto-register MCP endpoint in ~/.claude.json
  if (MCP_ENABLED) {
    try {
      const claudeJsonPath = join(homedir(), ".claude.json");
      const registered = registerMcpConfig(server.port ?? PORT, server.hostname, {
        readFile: (p) => {
          try {
            return readFileSync(p, "utf-8");
          } catch {
            return null;
          }
        },
        writeFile: (p, c) => writeFileSync(p, c, "utf-8"),
        removeFile: (p) => {
          try {
            unlinkSync(p);
          } catch {
            // Ignore if file doesn't exist
          }
        },
        fileExists: (p) => existsSync(p),
        claudeJsonPath,
        oldMcpJsonPath: join(homedir(), ".claude", ".mcp.json"),
      });
      if (registered) {
        console.log(`Registered MCP endpoint in ${claudeJsonPath}`);
      }
    } catch (err) {
      console.warn("Failed to register MCP config:", err);
    }
  }

  // Start session polling
  sessionManager.start();

  // Start background fetch for built-in commands
  builtinCommandProvider.start();
}

main();
