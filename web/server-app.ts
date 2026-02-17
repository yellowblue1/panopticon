/**
 * Hono app factory for testability.
 *
 * This module extracts the Hono app creation into a factory function
 * that accepts dependencies, enabling unit testing with mocked session data.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type {
  AgentType,
  AuthStatusResponse,
  BrowseEntry,
  BrowsePathResponse,
  DeletePlanResponse,
  GeminiBackend,
  LauncherConfigData,
  LauncherConfigResponse,
  LaunchResponse,
  PaneAction,
  PaneActionsResponse,
  PaneContentFull,
  PaneContentResponse,
  PlanResponse,
  PlansAvailabilityResponse,
  ProjectResponse,
  ProjectsApiResponse,
  SendKeysResponse,
  SendMessageResponse,
  SessionResponse,
  SlashCommand,
  SlashCommandsResponse,
  SwitchClientResponse,
} from "../src/shared/types";
import type { SendMessageResult } from "../src/terminal/application/send-message";

/**
 * Dependencies for the app factory.
 * All session operations are injected to enable testing.
 */
export interface AppDeps {
  getSessions: () => SessionResponse[];
  sendKeys?: (paneId: string, text: string) => boolean;
  sendRawKey?: (paneId: string, key: string) => boolean;
  switchClient?: (paneId: string) => boolean;
  capturePaneContent?: (paneId: string) => string | null;
  detectPaneActions?: (content: string) => Promise<PaneAction>;

  // Auth status
  geminiBackend?: GeminiBackend | null;
  isAiAvailable?: boolean;
  getGeminiAuthError?: () => boolean;

  // SSE callbacks (session list)
  onSseConnect?: (client: SseClient) => void;
  onSseDisconnect?: (client: SseClient) => void;
  serializeSessionsData?: () => string;

  // SSE callbacks (pane content)
  onPaneContentSseConnect?: (paneId: string, client: SseClient) => void;
  onPaneContentSseDisconnect?: (paneId: string, client: SseClient) => void;

  // Plan viewer
  getPlan?: (paneId: string) => { slug: string; content: string } | null;
  getPlansAvailability?: () => Record<string, boolean>;
  deletePlan?: (paneId: string) => boolean;

  // Settings: slash commands (read-only, auto-discovered)
  discoverSlashCommands?: () => SlashCommand[];
  getBuiltinCommands?: () => SlashCommand[] | null;

  // File upload + message sending
  sendMessage?: (
    paneId: string,
    text: string,
    files: Array<{ data: ArrayBuffer; name: string; type: string }>,
  ) => SendMessageResult;

  // Launcher
  discoverProjects?: () => ProjectResponse[];
  launchSession?: (config: {
    projectPath: string;
    agentType: AgentType;
    sessionName?: string;
  }) => LaunchResponse;
  getLauncherConfig?: () => LauncherConfigData;
  setLauncherConfig?: (config: LauncherConfigData) => LauncherConfigData;
  browsePath?: (path: string) => { entries: BrowseEntry[]; basePath: string };
}

/**
 * SSE client interface for connection tracking
 */
export interface SseClient {
  controller: ReadableStreamDefaultController;
}

/**
 * Options for app creation
 */
interface AppOptions {
  restrictCors?: boolean;
}

/**
 * Creates a Hono app with injected dependencies.
 */
export function createApp(deps: AppDeps, options: AppOptions = {}) {
  const { restrictCors = true } = options;

  const app = new Hono()
    .use("/*", secureHeaders())
    .use(
      "/*",
      cors(
        restrictCors
          ? {
              origin: (origin) => {
                if (!origin) return origin;
                const localhostPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
                if (localhostPattern.test(origin)) {
                  return origin;
                }
                return null;
              },
            }
          : undefined,
      ),
    )

    // GET /api/sessions
    .get("/api/sessions", (c) => {
      return c.json({
        sessions: deps.getSessions(),
        timestamp: Date.now(),
      });
    })

    // GET /api/sessions/plans (batch availability — must be before :pane_id routes)
    .get("/api/sessions/plans", (c) => {
      const plans = deps.getPlansAvailability?.() ?? {};
      return c.json({
        plans,
        timestamp: Date.now(),
      } satisfies PlansAvailabilityResponse);
    })

    // POST /api/sessions/:pane_id/send-keys
    .post("/api/sessions/:pane_id/send-keys", async (c) => {
      const body = await c.req.json().catch(() => null);
      if (!body || typeof body.text !== "string" || body.text.length === 0) {
        return c.json(
          {
            success: false,
            error: "Request body must include a non-empty 'text' field",
          } satisfies SendKeysResponse,
          400,
        );
      }

      const paneId = c.req.param("pane_id");
      const raw = body.raw === true;

      if (raw) {
        if (!deps.sendRawKey) {
          return c.json({ success: false, error: "Not available" } satisfies SendKeysResponse, 501);
        }
        const success = deps.sendRawKey(paneId, body.text);
        if (success) {
          return c.json({ success: true } satisfies SendKeysResponse);
        }
        return c.json(
          { success: false, error: "Failed to send key to pane" } satisfies SendKeysResponse,
          500,
        );
      }

      if (!deps.sendKeys) {
        return c.json({ success: false, error: "Not available" } satisfies SendKeysResponse, 501);
      }
      const success = deps.sendKeys(paneId, body.text);
      if (success) {
        return c.json({ success: true } satisfies SendKeysResponse);
      }
      return c.json(
        { success: false, error: "Failed to send keys to pane" } satisfies SendKeysResponse,
        500,
      );
    })

    // POST /api/sessions/:pane_id/send-message (multipart: text + files)
    .post("/api/sessions/:pane_id/send-message", async (c) => {
      if (!deps.sendMessage) {
        return c.json(
          { success: false, error: "Not available" } satisfies SendMessageResponse,
          501,
        );
      }

      const body = await c.req.parseBody({ all: true });
      const text = typeof body.text === "string" ? body.text : "";

      const rawFiles = body.files;
      const fileArray = Array.isArray(rawFiles) ? rawFiles : rawFiles ? [rawFiles] : [];
      const validFiles = fileArray.filter((f): f is File => f instanceof File);

      if (!text.trim() && validFiles.length === 0) {
        return c.json(
          { success: false, error: "Must provide text or files" } satisfies SendMessageResponse,
          400,
        );
      }

      const files = await Promise.all(
        validFiles.map(async (f) => ({
          data: await f.arrayBuffer(),
          name: f.name,
          type: f.type,
        })),
      );

      const paneId = c.req.param("pane_id");
      const result = deps.sendMessage(paneId, text, files);

      if (result.success) {
        return c.json({
          success: true,
          uploadedFiles: result.uploadedFiles.map((f) => ({
            originalName: f.originalName,
          })),
        } satisfies SendMessageResponse);
      }

      return c.json({ success: false, error: result.error } satisfies SendMessageResponse, 500);
    })

    // POST /api/sessions/:pane_id/switch
    .post("/api/sessions/:pane_id/switch", (c) => {
      if (!deps.switchClient) {
        return c.json(
          { success: false, error: "Not available" } satisfies SwitchClientResponse,
          501,
        );
      }

      const paneId = c.req.param("pane_id");
      const success = deps.switchClient(paneId);

      if (success) {
        return c.json({ success: true } satisfies SwitchClientResponse);
      }
      return c.json(
        {
          success: false,
          error: "Failed to switch to pane",
        } satisfies SwitchClientResponse,
        500,
      );
    })

    // GET /api/sessions/:pane_id/pane-content
    .get("/api/sessions/:pane_id/pane-content", (c) => {
      if (!deps.capturePaneContent) {
        return c.json(
          {
            pane_id: "",
            content: null,
            timestamp: Date.now(),
          } satisfies PaneContentResponse,
          501,
        );
      }
      const paneId = c.req.param("pane_id");
      const content = deps.capturePaneContent(paneId);
      return c.json({
        pane_id: paneId,
        content,
        timestamp: Date.now(),
      } satisfies PaneContentResponse);
    })

    // GET /api/sessions/:pane_id/actions
    .get("/api/sessions/:pane_id/actions", async (c) => {
      if (!deps.capturePaneContent || !deps.detectPaneActions) {
        return c.json(
          {
            pane_id: c.req.param("pane_id"),
            action: { type: "none" } as PaneAction,
            timestamp: Date.now(),
          } satisfies PaneActionsResponse,
          501,
        );
      }

      const paneId = c.req.param("pane_id");
      const content = deps.capturePaneContent(paneId);

      if (content === null) {
        return c.json({
          pane_id: paneId,
          action: { type: "none" } as PaneAction,
          timestamp: Date.now(),
        } satisfies PaneActionsResponse);
      }

      const action = await deps.detectPaneActions(content);
      return c.json({
        pane_id: paneId,
        action,
        timestamp: Date.now(),
      } satisfies PaneActionsResponse);
    })

    // GET /api/sessions/:pane_id/plan
    .get("/api/sessions/:pane_id/plan", (c) => {
      const paneId = c.req.param("pane_id");
      const plan = deps.getPlan?.(paneId) ?? null;
      return c.json({
        pane_id: paneId,
        plan,
        timestamp: Date.now(),
      } satisfies PlanResponse);
    })

    // DELETE /api/sessions/:pane_id/plan
    .delete("/api/sessions/:pane_id/plan", (c) => {
      if (!deps.deletePlan) {
        return c.json({ success: false, error: "Not available" } satisfies DeletePlanResponse, 501);
      }

      const paneId = c.req.param("pane_id");
      const success = deps.deletePlan(paneId);

      if (success) {
        return c.json({ success: true } satisfies DeletePlanResponse);
      }
      return c.json(
        {
          success: false,
          error: "Plan not found",
        } satisfies DeletePlanResponse,
        404,
      );
    })

    // GET /api/auth/status
    .get("/api/auth/status", (c) => {
      return c.json({
        ai_summary_available: deps.isAiAvailable ?? false,
        gemini_auth_error: deps.getGeminiAuthError?.() ?? false,
        gemini_backend: deps.geminiBackend ?? null,
      } satisfies AuthStatusResponse);
    })

    // GET /api/settings/slash-commands
    .get("/api/settings/slash-commands", (c) => {
      const discovered = deps.discoverSlashCommands?.() ?? [];
      const builtin = deps.getBuiltinCommands?.() ?? [];

      // Priority: discovered > builtin (discovered wins on duplicates)
      const seen = new Set<string>();
      const merged: SlashCommand[] = [];

      for (const cmd of discovered) {
        if (!seen.has(cmd.command)) {
          seen.add(cmd.command);
          merged.push(cmd);
        }
      }
      for (const cmd of builtin) {
        if (!seen.has(cmd.command)) {
          seen.add(cmd.command);
          merged.push(cmd);
        }
      }

      return c.json({
        commands: merged,
        timestamp: Date.now(),
      } satisfies SlashCommandsResponse);
    })

    // GET /api/launcher/projects
    .get("/api/launcher/projects", (c) => {
      const projects = deps.discoverProjects?.() ?? [];
      return c.json({
        projects,
        timestamp: Date.now(),
      } satisfies ProjectsApiResponse);
    })

    // POST /api/launcher/launch
    .post("/api/launcher/launch", async (c) => {
      if (!deps.launchSession) {
        return c.json(
          {
            success: false,
            sessionName: "",
            paneId: null,
            error: "Not available",
          } satisfies LaunchResponse,
          501,
        );
      }

      const body = await c.req.json().catch(() => null);
      if (
        !body ||
        typeof body.projectPath !== "string" ||
        typeof body.agentType !== "string" ||
        (body.agentType !== "claude" && body.agentType !== "codex")
      ) {
        return c.json(
          {
            success: false,
            sessionName: "",
            paneId: null,
            error:
              "Request body must include 'projectPath' (string) and 'agentType' ('claude' | 'codex')",
          } satisfies LaunchResponse,
          400,
        );
      }

      const sessionName =
        typeof body.sessionName === "string" && body.sessionName.length > 0
          ? body.sessionName
          : undefined;

      const result = deps.launchSession({
        projectPath: body.projectPath,
        agentType: body.agentType as AgentType,
        sessionName,
      });

      return c.json(result satisfies LaunchResponse, result.success ? 200 : 500);
    })

    // GET /api/launcher/config
    .get("/api/launcher/config", (c) => {
      const config = deps.getLauncherConfig?.() ?? { scanPaths: [], useGhq: true };
      return c.json({
        config,
        timestamp: Date.now(),
      } satisfies LauncherConfigResponse);
    })

    // PUT /api/launcher/config
    .put("/api/launcher/config", async (c) => {
      if (!deps.setLauncherConfig) {
        return c.json({ error: "Not available" }, 501);
      }

      const body = await c.req.json().catch(() => null);
      if (
        !body ||
        !body.config ||
        !Array.isArray(body.config.scanPaths) ||
        typeof body.config.useGhq !== "boolean"
      ) {
        return c.json(
          {
            error:
              "Request body must include 'config' with 'scanPaths' (string[]) and 'useGhq' (boolean)",
          },
          400,
        );
      }

      for (const path of body.config.scanPaths) {
        if (typeof path !== "string") {
          return c.json({ error: "Each scanPath must be a string" }, 400);
        }
      }

      const config = deps.setLauncherConfig(body.config);
      return c.json({
        config,
        timestamp: Date.now(),
      } satisfies LauncherConfigResponse);
    })

    // GET /api/launcher/browse
    .get("/api/launcher/browse", (c) => {
      if (!deps.browsePath) {
        return c.json(
          { entries: [], basePath: "", timestamp: Date.now() } satisfies BrowsePathResponse,
          501,
        );
      }

      const path = c.req.query("path") ?? "";
      if (path.length === 0) {
        return c.json({
          entries: [],
          basePath: "",
          timestamp: Date.now(),
        } satisfies BrowsePathResponse);
      }

      const result = deps.browsePath(path);
      return c.json({
        entries: result.entries,
        basePath: result.basePath,
        timestamp: Date.now(),
      } satisfies BrowsePathResponse);
    })

    // Favicon routes
    .get("/favicon.ico", (c) => {
      const faviconPath = join(import.meta.dirname, "public", "favicon.svg");
      const favicon = readFileSync(faviconPath);
      return c.body(favicon, 200, {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=86400",
      });
    })
    .get("/favicon.svg", (c) => {
      const faviconPath = join(import.meta.dirname, "public", "favicon.svg");
      const favicon = readFileSync(faviconPath);
      return c.body(favicon, 200, {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=86400",
      });
    })

    // SSE endpoint (session list)
    .get("/api/sessions/stream", (_c) => {
      let client: SseClient;

      const stream = new ReadableStream({
        start(controller) {
          client = { controller };
          deps.onSseConnect?.(client);

          // Send initial data
          const data = deps.serializeSessionsData?.() ?? "{}";
          controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
        },
        cancel() {
          deps.onSseDisconnect?.(client);
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    })

    // SSE endpoint (pane content — per-pane streaming)
    .get("/api/sessions/:pane_id/pane-content/stream", (c) => {
      const paneId = c.req.param("pane_id");
      let client: SseClient;

      const stream = new ReadableStream({
        start(controller) {
          client = { controller };
          deps.onPaneContentSseConnect?.(paneId, client);

          // Send initial content as full message
          const content = deps.capturePaneContent?.(paneId) ?? null;
          const initial = JSON.stringify({
            type: "full",
            pane_id: paneId,
            content,
            timestamp: Date.now(),
            seq: 0,
          } satisfies PaneContentFull);
          controller.enqueue(new TextEncoder().encode(`data: ${initial}\n\n`));
        },
        cancel() {
          deps.onPaneContentSseDisconnect?.(paneId, client);
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    });

  return app;
}

/**
 * App type for RPC client usage
 */
export type AppType = ReturnType<typeof createApp>;
