import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { serveStatic } from "hono/bun";
import { detectPaneActions } from "../src/intelligence/application/detect-actions";
import { generatePaneSummary } from "../src/intelligence/application/summarize";
import type { ActionDeps, SummaryDeps } from "../src/intelligence/domain/ports";
import { hasAuthError } from "../src/intelligence/infrastructure/auth-error-state";
import { createGenerateContentFn } from "../src/intelligence/infrastructure/gemini-client";
import { bootstrapGeminiEnv } from "../src/intelligence/infrastructure/gemini-config";
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
import { DEFAULT_SLASH_COMMANDS } from "../src/shared/default-slash-commands";
import { computeLineDiff, isDiffWorthSending } from "../src/shared/pane-diff";
import type { PaneContentDiff, PaneContentFull, SlashCommand } from "../src/shared/types";
import {
  buildTmuxTarget,
  getMonitoredProcesses,
  matchProcessesToPanes,
} from "../src/terminal/infrastructure/process-matching";
import { sanitizePaneContent } from "../src/terminal/infrastructure/sanitize";
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
  sendKeys,
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

// ═══ Slash commands config ═══

const CONFIG_DIR = join(homedir(), ".config", "panopticon");
const CACHE_DIR = join(homedir(), ".cache", "panopticon");
const SLASH_COMMANDS_PATH = join(CONFIG_DIR, "slash-commands.json");

function isValidSlashCommand(item: unknown): item is SlashCommand {
  return (
    typeof item === "object" &&
    item !== null &&
    typeof (item as SlashCommand).command === "string" &&
    typeof (item as SlashCommand).description === "string"
  );
}

function readSlashCommands(): SlashCommand[] {
  try {
    if (!existsSync(SLASH_COMMANDS_PATH)) {
      return DEFAULT_SLASH_COMMANDS;
    }
    const raw = readFileSync(SLASH_COMMANDS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every(isValidSlashCommand)) {
      return parsed;
    }
    return DEFAULT_SLASH_COMMANDS;
  } catch {
    return DEFAULT_SLASH_COMMANDS;
  }
}

function writeSlashCommands(commands: SlashCommand[]): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(SLASH_COMMANDS_PATH, JSON.stringify(commands, null, 2), "utf-8");
}

// ═══ Builtin command fetcher ═══

const builtinCommandProvider = new BuiltinCommandProvider({
  fetchText: async (url) => {
    const res = await fetch(url);
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

// Create separate generateContent functions per use case (only if Gemini is configured)
const summaryGenerateContent = geminiBackend ? createGenerateContentFn("gemini-2.5-flash") : null;
const actionGenerateContent = geminiBackend ? createGenerateContentFn("gemini-2.5-flash") : null;

const summaryDeps: SummaryDeps = {
  generateContent: summaryGenerateContent ?? (async () => null),
};

const actionDeps: ActionDeps = {
  generateContent: actionGenerateContent ?? (async () => null),
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
    // Uses escaped variant to preserve ANSI codes for xterm.js rendering
    capturePaneContent: capturePaneContentEscaped,
    detectPaneActions: async (rawContent: string) => {
      const sanitized = sanitizePaneContent(rawContent);
      return detectPaneActions(sanitized, actionDeps);
    },
    geminiBackend,
    isAiAvailable: geminiBackend !== null,
    getGeminiAuthError: hasAuthError,
    getPlan: (paneId) => {
      const cwd = sessionManager.getSessionCwd(paneId);
      if (!cwd) return null;

      // Reuse slug cache to avoid re-reading JSONL files
      if (!slugCache.has(cwd)) {
        slugCache.set(cwd, findSlugForCwd(cwd, planDeps));
      }
      const slug = slugCache.get(cwd);
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
        if (!slugCache.has(cwd)) {
          slugCache.set(cwd, findSlugForCwd(cwd, planDeps));
        }
        const slug = slugCache.get(cwd);
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

      if (!slugCache.has(cwd)) {
        slugCache.set(cwd, findSlugForCwd(cwd, planDeps));
      }
      const slug = slugCache.get(cwd);
      if (!slug) return false;

      const success = deletePlan(slug, planDeps);
      if (success) {
        slugCache.delete(cwd);
      }
      return success;
    },
    getBuiltinCommands: () => builtinCommandProvider.getCommands(),
    getSlashCommands: readSlashCommands,
    setSlashCommands: (commands) => {
      writeSlashCommands(commands);
      return commands;
    },
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
  { restrictCors: true },
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

  // Start session polling
  sessionManager.start();

  // Start background fetch for built-in commands
  builtinCommandProvider.start();
}

main();
