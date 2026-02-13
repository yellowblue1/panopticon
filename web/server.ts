import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { serveStatic } from "hono/bun";
import { detectPaneActions } from "../src/intelligence/application/detect-actions";
import { generatePaneSummary } from "../src/intelligence/application/summarize";
import type { ActionDeps, SummaryDeps } from "../src/intelligence/domain/ports";
import { hasAuthError } from "../src/intelligence/infrastructure/auth-error-state";
import { getGcpLocation, getGcpProject } from "../src/intelligence/infrastructure/gcp-config";
import { createGenerateContentFn } from "../src/intelligence/infrastructure/gemini-client";
import { SessionManager } from "../src/session/application/session-manager";
import type { SessionManagerDeps } from "../src/session/domain/ports";
import { defaultCreateFifo, defaultSpawnFifoReader } from "../src/session/infrastructure/fifo";
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
  getProcessCwd,
  getProcessStartTime,
  getProcessTable,
  getProjectName,
  isTmuxAvailable,
  sendKeys,
  sendRawKey,
  startPipePane,
  stopPipePane,
} from "../src/terminal/infrastructure/tmux-commands";
import { type AppType, createApp, type SseClient } from "./server-app";

const DEFAULT_PORT = 3847;
const DEFAULT_HOST = "127.0.0.1";
const PORT = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : DEFAULT_PORT;
const HOST = process.env.HOST ?? DEFAULT_HOST;

// ═══ Wire dependencies ═══

const gcpProject = getGcpProject();
const gcpLocation = getGcpLocation();

// Create separate generateContent functions per use case (only if project is configured)
const summaryGenerateContent = gcpProject
  ? createGenerateContentFn(gcpProject, gcpLocation, "gemini-2.5-flash")
  : null;
const actionGenerateContent = gcpProject
  ? createGenerateContentFn(gcpProject, gcpLocation, "gemini-2.5-flash")
  : null;

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

// SSE clients (session list)
const clients: Set<SseClient> = new Set();

// SSE clients (pane content — per-pane)
const paneContentClients = new Map<string, Set<SseClient>>();
const paneContentDebounce = new Map<string, ReturnType<typeof setTimeout>>();
const paneContentHashes = new Map<string, string>();
const PANE_CONTENT_DEBOUNCE_MS = 200;

// Session manager with tmux polling
const sessionManager = new SessionManager(sessionManagerDeps);

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
      client.controller.enqueue(new TextEncoder().encode(message));
    } catch {
      clients.delete(client);
    }
  }
}

// Broadcast when session state changes
sessionManager.onChange(() => {
  broadcastUpdate();
});

// Debounced pane content push via SSE
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

      // Push to watching clients
      const message = `data: ${JSON.stringify({ pane_id: paneId, content, timestamp: Date.now() })}\n\n`;
      const encoded = new TextEncoder().encode(message);
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
    // Uses escaped variant to preserve ANSI codes for xterm.js rendering
    capturePaneContent: capturePaneContentEscaped,
    detectPaneActions: async (rawContent: string) => {
      const sanitized = sanitizePaneContent(rawContent);
      return detectPaneActions(sanitized, actionDeps);
    },
    getGcpProject,
    isAiAvailable: gcpProject !== null,
    getGeminiAuthError: hasAuthError,
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
    },
    onPaneContentSseDisconnect: (paneId, client) => {
      const watchers = paneContentClients.get(paneId);
      if (watchers) {
        watchers.delete(client);
        if (watchers.size === 0) {
          paneContentClients.delete(paneId);
          // Clean up debounce timer and hash when no watchers
          const timer = paneContentDebounce.get(paneId);
          if (timer) {
            clearTimeout(timer);
            paneContentDebounce.delete(paneId);
          }
          paneContentHashes.delete(paneId);
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
}

main();
