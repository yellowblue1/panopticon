/**
 * Hono API integration tests.
 *
 * Tests all API endpoints using app.request() without starting an HTTP server.
 * Dependencies are mocked for isolation.
 */

import { describe, expect, it, mock } from "bun:test";
import type { SessionResponse } from "../src/shared/types";
import { type AppDeps, createApp, type SseClient } from "./server-app";

function createMockDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    getSessions: () => [],
    sendKeys: () => true,
    sendRawKey: () => true,
    switchClient: () => true,
    sendInterrupt: () => true,
    capturePaneContent: () => null,
    detectPaneActions: async () => ({ type: "none" }),
    geminiBackend: "vertex-ai",
    isAiAvailable: true,
    getGeminiAuthError: () => false,
    onSseConnect: () => {},
    onSseDisconnect: () => {},
    serializeSessionsData: () => "{}",
    onPaneContentSseConnect: () => {},
    onPaneContentSseDisconnect: () => {},
    deletePlan: () => true,
    ...overrides,
  };
}

const sampleSession: SessionResponse = {
  pane_id: "%0",
  project_name: "my-project",
  git_branch: "main",
  status: "busy",
  summary: null,
  tmux_target: "main:0.0",
  last_activity: new Date().toISOString(),
  cwd: "/home/user/my-project",
};

describe("Hono API endpoints", () => {
  describe("GET /api/sessions", () => {
    it("returns sessions with timestamp", async () => {
      const deps = createMockDeps({
        getSessions: () => [sampleSession],
      });
      const app = createApp(deps);
      const res = await app.request("/api/sessions");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.sessions).toHaveLength(1);
      expect(data.sessions[0].pane_id).toBe("%0");
      expect(data.timestamp).toBeGreaterThan(0);
    });

    it("returns empty array when no sessions", async () => {
      const deps = createMockDeps({ getSessions: () => [] });
      const app = createApp(deps);

      const res = await app.request("/api/sessions");
      const data = await res.json();

      expect(data.sessions).toEqual([]);
    });
  });

  describe("POST /api/sessions/:pane_id/send-keys", () => {
    it("returns success when sendKeys succeeds", async () => {
      const sendKeysSpy = mock((_paneId: string, _text: string) => true);
      const deps = createMockDeps({ sendKeys: sendKeysSpy });
      const app = createApp(deps);

      const res = await app.request("/api/sessions/%250/send-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "hello" }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(sendKeysSpy).toHaveBeenCalledWith("%0", "hello");
    });

    it("returns 400 when text is missing", async () => {
      const deps = createMockDeps();
      const app = createApp(deps);

      const res = await app.request("/api/sessions/%250/send-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
    });

    it("returns 400 when text is empty string", async () => {
      const deps = createMockDeps();
      const app = createApp(deps);

      const res = await app.request("/api/sessions/%250/send-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 when body is not valid JSON", async () => {
      const deps = createMockDeps();
      const app = createApp(deps);

      const res = await app.request("/api/sessions/%250/send-keys", {
        method: "POST",
        body: "not json",
      });

      expect(res.status).toBe(400);
    });

    it("returns 500 when sendKeys fails", async () => {
      const deps = createMockDeps({ sendKeys: () => false });
      const app = createApp(deps);

      const res = await app.request("/api/sessions/%250/send-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "hello" }),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.success).toBe(false);
    });

    it("returns 501 when sendKeys dependency is not provided", async () => {
      const { sendKeys: _, ...depsWithoutSendKeys } = createMockDeps();
      const app = createApp(depsWithoutSendKeys as AppDeps);

      const res = await app.request("/api/sessions/%250/send-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "hello" }),
      });

      expect(res.status).toBe(501);
    });

    it("sends raw key when raw flag is true", async () => {
      const sendRawKeySpy = mock((_paneId: string, _key: string) => true);
      const deps = createMockDeps({ sendRawKey: sendRawKeySpy });
      const app = createApp(deps);

      const res = await app.request("/api/sessions/%250/send-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Escape", raw: true }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(sendRawKeySpy).toHaveBeenCalledWith("%0", "Escape");
    });

    it("returns 500 when sendRawKey fails", async () => {
      const deps = createMockDeps({ sendRawKey: () => false });
      const app = createApp(deps);

      const res = await app.request("/api/sessions/%250/send-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Escape", raw: true }),
      });

      expect(res.status).toBe(500);
    });

    it("returns 501 when sendRawKey dependency is not provided for raw mode", async () => {
      const { sendRawKey: _, ...depsWithout } = createMockDeps();
      const app = createApp(depsWithout as AppDeps);

      const res = await app.request("/api/sessions/%250/send-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Escape", raw: true }),
      });

      expect(res.status).toBe(501);
    });
  });

  describe("POST /api/sessions/:pane_id/send-message", () => {
    it("returns 501 when sendMessage dependency is not provided", async () => {
      const deps = createMockDeps({ sendMessage: undefined });
      const app = createApp(deps);

      const formData = new FormData();
      formData.append("text", "hello");
      const res = await app.request("/api/sessions/%250/send-message", {
        method: "POST",
        body: formData,
      });

      expect(res.status).toBe(501);
    });

    it("returns 400 when both text and files are empty", async () => {
      const deps = createMockDeps({
        sendMessage: mock(() => ({ success: true, uploadedFiles: [] })),
      });
      const app = createApp(deps);

      const formData = new FormData();
      formData.append("text", "");
      const res = await app.request("/api/sessions/%250/send-message", {
        method: "POST",
        body: formData,
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
    });

    it("returns success for text-only message", async () => {
      const sendMessageSpy = mock((_paneId: string, _text: string, _files: unknown[]) => ({
        success: true,
        uploadedFiles: [],
      }));
      const deps = createMockDeps({ sendMessage: sendMessageSpy });
      const app = createApp(deps);

      const formData = new FormData();
      formData.append("text", "check this");
      const res = await app.request("/api/sessions/%250/send-message", {
        method: "POST",
        body: formData,
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(sendMessageSpy).toHaveBeenCalled();
      const [paneId, text] = sendMessageSpy.mock.calls[0];
      expect(paneId).toBe("%0");
      expect(text).toBe("check this");
    });

    it("returns success for message with file", async () => {
      const sendMessageSpy = mock((_paneId: string, _text: string, _files: unknown[]) => ({
        success: true,
        uploadedFiles: [
          {
            originalName: "test.png",
            savedPath: "/tmp/panopticon-uploads/123-test.png",
            mimeType: "image/png",
            size: 100,
          },
        ],
      }));
      const deps = createMockDeps({ sendMessage: sendMessageSpy });
      const app = createApp(deps);

      const formData = new FormData();
      formData.append("text", "see image");
      formData.append("files", new File([new ArrayBuffer(100)], "test.png", { type: "image/png" }));
      const res = await app.request("/api/sessions/%250/send-message", {
        method: "POST",
        body: formData,
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.uploadedFiles).toHaveLength(1);
      expect(data.uploadedFiles[0].originalName).toBe("test.png");
      expect(data.uploadedFiles[0]).not.toHaveProperty("savedPath");
    });

    it("returns 500 when sendMessage fails", async () => {
      const deps = createMockDeps({
        sendMessage: mock(() => ({
          success: false,
          error: "Failed to send",
          uploadedFiles: [],
        })),
      });
      const app = createApp(deps);

      const formData = new FormData();
      formData.append("text", "hello");
      const res = await app.request("/api/sessions/%250/send-message", {
        method: "POST",
        body: formData,
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Failed to send");
    });
  });

  describe("POST /api/sessions/:pane_id/switch", () => {
    it("returns success when switchClient succeeds", async () => {
      const switchClientSpy = mock((_paneId: string) => true);
      const deps = createMockDeps({ switchClient: switchClientSpy });
      const app = createApp(deps);

      const res = await app.request("/api/sessions/%250/switch", {
        method: "POST",
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(switchClientSpy).toHaveBeenCalledWith("%0");
    });

    it("returns 500 when switchClient fails", async () => {
      const deps = createMockDeps({ switchClient: () => false });
      const app = createApp(deps);

      const res = await app.request("/api/sessions/%250/switch", {
        method: "POST",
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.success).toBe(false);
    });

    it("returns 501 when switchClient dependency is not provided", async () => {
      const { switchClient: _, ...depsWithout } = createMockDeps();
      const app = createApp(depsWithout as AppDeps);

      const res = await app.request("/api/sessions/%250/switch", {
        method: "POST",
      });

      expect(res.status).toBe(501);
    });
  });

  describe("POST /api/sessions/:pane_id/interrupt", () => {
    it("returns success when sendInterrupt succeeds", async () => {
      const sendInterruptSpy = mock((_paneId: string) => true);
      const deps = createMockDeps({ sendInterrupt: sendInterruptSpy });
      const app = createApp(deps);

      const res = await app.request("/api/sessions/%250/interrupt", {
        method: "POST",
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(sendInterruptSpy).toHaveBeenCalledWith("%0");
    });

    it("returns 500 when sendInterrupt fails", async () => {
      const deps = createMockDeps({ sendInterrupt: () => false });
      const app = createApp(deps);

      const res = await app.request("/api/sessions/%250/interrupt", {
        method: "POST",
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.success).toBe(false);
    });

    it("returns 501 when sendInterrupt dependency is not provided", async () => {
      const { sendInterrupt: _, ...depsWithout } = createMockDeps();
      const app = createApp(depsWithout as AppDeps);

      const res = await app.request("/api/sessions/%250/interrupt", {
        method: "POST",
      });

      expect(res.status).toBe(501);
    });
  });

  describe("DELETE /api/sessions/:pane_id/plan", () => {
    it("returns success when plan is deleted", async () => {
      const deletePlanSpy = mock((_paneId: string) => true);
      const deps = createMockDeps({ deletePlan: deletePlanSpy });
      const app = createApp(deps);

      const res = await app.request("/api/sessions/%250/plan", {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(deletePlanSpy).toHaveBeenCalledWith("%0");
    });

    it("returns 404 when plan does not exist", async () => {
      const deps = createMockDeps({ deletePlan: () => false });
      const app = createApp(deps);

      const res = await app.request("/api/sessions/%250/plan", {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
    });

    it("returns 501 when deletePlan dependency is not provided", async () => {
      const deps = createMockDeps({ deletePlan: undefined });
      const app = createApp(deps);

      const res = await app.request("/api/sessions/%250/plan", {
        method: "DELETE",
      });

      expect(res.status).toBe(501);
      const data = await res.json();
      expect(data.success).toBe(false);
    });
  });

  describe("GET /api/sessions/:pane_id/pane-content", () => {
    it("returns pane content when available", async () => {
      const deps = createMockDeps({
        capturePaneContent: () => "$ hello world\n",
      });
      const app = createApp(deps);

      const res = await app.request("/api/sessions/%250/pane-content");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.pane_id).toBe("%0");
      expect(data.content).toBe("$ hello world\n");
      expect(data.timestamp).toBeGreaterThan(0);
    });

    it("returns null content when pane not found", async () => {
      const deps = createMockDeps({
        capturePaneContent: () => null,
      });
      const app = createApp(deps);

      const res = await app.request("/api/sessions/%250/pane-content");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.content).toBeNull();
    });

    it("returns 501 when capturePaneContent is not provided", async () => {
      const deps = createMockDeps({ capturePaneContent: undefined });
      const app = createApp(deps);

      const res = await app.request("/api/sessions/%250/pane-content");

      expect(res.status).toBe(501);
    });
  });

  describe("GET /api/sessions/:pane_id/pane-content/stream", () => {
    it("returns SSE stream with initial full pane content", async () => {
      const deps = createMockDeps({
        capturePaneContent: () => "$ hello world\n",
      });
      const app = createApp(deps);

      const res = await app.request("/api/sessions/%250/pane-content/stream");

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/event-stream");
      expect(res.headers.get("Cache-Control")).toBe("no-cache");

      const reader = res.body?.getReader();
      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);
      expect(text).toContain("data: ");
      const json = JSON.parse(text.replace("data: ", "").trim());
      expect(json.type).toBe("full");
      expect(json.pane_id).toBe("%0");
      expect(json.content).toBe("$ hello world\n");
      expect(json.seq).toBe(0);
      expect(json.timestamp).toBeGreaterThan(0);
      reader.cancel();
    });

    it("calls onPaneContentSseConnect and onPaneContentSseDisconnect", async () => {
      let connectedPaneId = "";
      let disconnectedPaneId = "";
      const deps = createMockDeps({
        capturePaneContent: () => "content",
        onPaneContentSseConnect: (paneId, _client) => {
          connectedPaneId = paneId;
        },
        onPaneContentSseDisconnect: (paneId, _client) => {
          disconnectedPaneId = paneId;
        },
      });
      const app = createApp(deps);

      const res = await app.request("/api/sessions/%250/pane-content/stream");
      const reader = res.body?.getReader();
      await reader.read();
      expect(connectedPaneId).toBe("%0");

      await reader.cancel();
      expect(disconnectedPaneId).toBe("%0");
    });

    it("sends null content with type full when capturePaneContent is not provided", async () => {
      const deps = createMockDeps();
      const app = createApp(deps);

      const res = await app.request("/api/sessions/%250/pane-content/stream");
      const reader = res.body?.getReader();
      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);
      const json = JSON.parse(text.replace("data: ", "").trim());
      expect(json.type).toBe("full");
      expect(json.content).toBeNull();
      expect(json.seq).toBe(0);
      reader.cancel();
    });
  });

  describe("GET /api/sessions/:pane_id/actions", () => {
    it("returns detected action when pane content is available", async () => {
      const deps = createMockDeps({
        capturePaneContent: () => "Do you want to proceed? (y/n)",
        detectPaneActions: async () => ({ type: "yesno" }),
      });
      const app = createApp(deps);

      const res = await app.request("/api/sessions/%250/actions");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.pane_id).toBe("%0");
      expect(data.action.type).toBe("yesno");
      expect(data.timestamp).toBeGreaterThan(0);
    });

    it("returns choices action with options", async () => {
      const deps = createMockDeps({
        capturePaneContent: () => "1. Option A\n2. Option B",
        detectPaneActions: async () => ({
          type: "choices",
          options: [
            { label: "1", value: "1", autoEnter: true },
            { label: "2", value: "2", autoEnter: true },
          ],
        }),
      });
      const app = createApp(deps);

      const res = await app.request("/api/sessions/%250/actions");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.action.type).toBe("choices");
      expect(data.action.options).toHaveLength(2);
    });

    it("returns none when pane content is null", async () => {
      const deps = createMockDeps({
        capturePaneContent: () => null,
        detectPaneActions: async () => ({ type: "yesno" }),
      });
      const app = createApp(deps);

      const res = await app.request("/api/sessions/%250/actions");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.action.type).toBe("none");
    });

    it("returns 501 when detectPaneActions is not provided", async () => {
      const deps = createMockDeps({ detectPaneActions: undefined });
      const app = createApp(deps);

      const res = await app.request("/api/sessions/%250/actions");

      expect(res.status).toBe(501);
      const data = await res.json();
      expect(data.action.type).toBe("none");
    });

    it("returns 501 when capturePaneContent is not provided", async () => {
      const deps = createMockDeps({ capturePaneContent: undefined });
      const app = createApp(deps);

      const res = await app.request("/api/sessions/%250/actions");

      expect(res.status).toBe(501);
    });
  });

  describe("GET /api/auth/status", () => {
    it("returns available with backend when configured", async () => {
      const deps = createMockDeps({
        geminiBackend: "vertex-ai",
        isAiAvailable: true,
      });
      const app = createApp(deps);

      const res = await app.request("/api/auth/status");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ai_summary_available).toBe(true);
      expect(data.gemini_backend).toBe("vertex-ai");
      expect(data.gemini_auth_error).toBe(false);
    });

    it("returns google-ai backend when using API key", async () => {
      const deps = createMockDeps({
        geminiBackend: "google-ai",
        isAiAvailable: true,
      });
      const app = createApp(deps);

      const res = await app.request("/api/auth/status");
      const data = await res.json();

      expect(data.ai_summary_available).toBe(true);
      expect(data.gemini_backend).toBe("google-ai");
    });

    it("returns unavailable with null backend when not configured", async () => {
      const deps = createMockDeps({
        geminiBackend: null,
        isAiAvailable: false,
      });
      const app = createApp(deps);

      const res = await app.request("/api/auth/status");
      const data = await res.json();

      expect(data.ai_summary_available).toBe(false);
      expect(data.gemini_backend).toBeNull();
    });

    it("returns gemini_auth_error true when auth error is active", async () => {
      const deps = createMockDeps({
        getGeminiAuthError: () => true,
      });
      const app = createApp(deps);

      const res = await app.request("/api/auth/status");
      const data = await res.json();

      expect(data.gemini_auth_error).toBe(true);
    });

    it("returns gemini_auth_error false when no auth error", async () => {
      const deps = createMockDeps({
        getGeminiAuthError: () => false,
      });
      const app = createApp(deps);

      const res = await app.request("/api/auth/status");
      const data = await res.json();

      expect(data.gemini_auth_error).toBe(false);
    });

    it("defaults gemini_auth_error to false when getGeminiAuthError not provided", async () => {
      const deps = createMockDeps({
        getGeminiAuthError: undefined,
      });
      const app = createApp(deps);

      const res = await app.request("/api/auth/status");
      const data = await res.json();

      expect(data.gemini_auth_error).toBe(false);
    });
  });

  describe("GET /api/sessions/stream (SSE)", () => {
    it("returns SSE response headers", async () => {
      const deps = createMockDeps({
        serializeSessionsData: () => '{"sessions":[],"timestamp":0}',
      });
      const app = createApp(deps);

      const res = await app.request("/api/sessions/stream");

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/event-stream");
      expect(res.headers.get("Cache-Control")).toBe("no-cache");
      expect(res.headers.get("Connection")).toBe("keep-alive");
    });

    it("calls onSseConnect with client info", async () => {
      const onSseConnectSpy = mock((_client: SseClient) => {});
      const deps = createMockDeps({
        onSseConnect: onSseConnectSpy,
        serializeSessionsData: () => "{}",
      });
      const app = createApp(deps);

      await app.request("/api/sessions/stream");

      expect(onSseConnectSpy).toHaveBeenCalled();
    });

    it("sends initial data on connection", async () => {
      const initialData = '{"sessions":[{"pane_id":"%0"}],"timestamp":123}';
      const deps = createMockDeps({
        serializeSessionsData: () => initialData,
      });
      const app = createApp(deps);

      const res = await app.request("/api/sessions/stream");
      const reader = res.body?.getReader();
      const result = await reader?.read();
      const text = new TextDecoder().decode(result?.value);

      expect(text).toContain(`data: ${initialData}`);
      expect(text).toContain("\n\n");
    });
  });
});

describe("Settings API endpoints", () => {
  describe("GET /api/settings/slash-commands", () => {
    it("returns empty commands when no deps provided", async () => {
      const deps = createMockDeps();
      const app = createApp(deps);

      const res = await app.request("/api/settings/slash-commands");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.commands).toEqual([]);
      expect(data.timestamp).toBeGreaterThan(0);
    });

    it("returns discovered commands", async () => {
      const discovered = [
        { command: "/plan", description: "Custom command (project)" },
        { command: "/deploy", description: "Custom command (global)" },
      ];
      const deps = createMockDeps({
        discoverSlashCommands: () => discovered,
      });
      const app = createApp(deps);

      const res = await app.request("/api/settings/slash-commands");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.commands).toEqual(discovered);
    });

    it("returns builtin commands when no discovered", async () => {
      const builtin = [
        { command: "/clear", description: "Clear history" },
        { command: "/plan", description: "Enter plan mode" },
      ];
      const deps = createMockDeps({
        discoverSlashCommands: () => [],
        getBuiltinCommands: () => builtin,
      });
      const app = createApp(deps);

      const res = await app.request("/api/settings/slash-commands");
      const data = await res.json();
      expect(data.commands).toEqual(builtin);
    });

    it("returns empty array when getBuiltinCommands returns null", async () => {
      const deps = createMockDeps({
        discoverSlashCommands: () => [],
        getBuiltinCommands: () => null,
      });
      const app = createApp(deps);

      const res = await app.request("/api/settings/slash-commands");
      const data = await res.json();
      expect(data.commands).toEqual([]);
    });

    it("discovered commands take priority over builtin with same name", async () => {
      const discovered = [
        { command: "/clear", description: "Discovered clear" },
        { command: "/deploy", description: "Custom command (project)" },
      ];
      const builtin = [
        { command: "/clear", description: "Built-in clear" },
        { command: "/deploy", description: "Built-in deploy" },
        { command: "/plan", description: "Enter plan mode" },
      ];
      const deps = createMockDeps({
        discoverSlashCommands: () => discovered,
        getBuiltinCommands: () => builtin,
      });
      const app = createApp(deps);

      const res = await app.request("/api/settings/slash-commands");
      const data = await res.json();
      expect(data.commands).toEqual([
        { command: "/clear", description: "Discovered clear" },
        { command: "/deploy", description: "Custom command (project)" },
        { command: "/plan", description: "Enter plan mode" },
      ]);
    });

    it("works without discoverSlashCommands dep", async () => {
      const builtin = [{ command: "/help", description: "Get help" }];
      const deps = createMockDeps({
        discoverSlashCommands: undefined,
        getBuiltinCommands: () => builtin,
      });
      const app = createApp(deps);

      const res = await app.request("/api/settings/slash-commands");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.commands).toEqual(builtin);
    });
  });
});

describe("CORS behavior", () => {
  describe("with restrictCors: true (default)", () => {
    it("handles preflight for localhost origin", async () => {
      const deps = createMockDeps();
      const app = createApp(deps, { restrictCors: true });

      const res = await app.request("/api/sessions", {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:3847",
          "Access-Control-Request-Method": "GET",
        },
      });

      expect(res.status).toBe(204);
    });

    it("rejects external origin on preflight", async () => {
      const deps = createMockDeps();
      const app = createApp(deps, { restrictCors: true });

      const res = await app.request("/api/sessions", {
        method: "OPTIONS",
        headers: {
          Origin: "https://evil.com",
          "Access-Control-Request-Method": "GET",
        },
      });

      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("allows requests with no origin (same-origin/curl)", async () => {
      const deps = createMockDeps();
      const app = createApp(deps, { restrictCors: true });

      const res = await app.request("/api/sessions");
      expect(res.status).toBe(200);
    });
  });

  describe("with restrictCors: false", () => {
    it("allows any origin on preflight", async () => {
      const deps = createMockDeps();
      const app = createApp(deps, { restrictCors: false });

      const res = await app.request("/api/sessions", {
        method: "OPTIONS",
        headers: {
          Origin: "https://any-origin.com",
          "Access-Control-Request-Method": "GET",
        },
      });

      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });
  });
});

describe("HTTP methods", () => {
  it("returns 404 for unknown routes", async () => {
    const deps = createMockDeps();
    const app = createApp(deps);

    const res = await app.request("/api/unknown");
    expect(res.status).toBe(404);
  });
});
