import { describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { createMcpHandler } from "./mcp-handler";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function toolCall(args: Record<string, unknown>) {
  return { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "push", arguments: args } };
}

function handler() {
  return createMcpHandler((server) => {
    server.registerTool("push", { inputSchema: { path: z.string() } }, async ({ path }, extra) => {
      // Match the production tools' dependency on the caller's pane header.
      await Bun.sleep(1);
      return {
        content: [{ type: "text", text: `${extra.requestInfo?.headers["x-pane-id"]}:${path}` }],
      };
    });
  });
}

describe("MCP HTTP boundary", () => {
  it("supports the SDK client lifecycle and repeated tool calls", async () => {
    const handle = handler();
    const client = new Client({ name: "test", version: "1" });
    const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
      requestInit: { headers: { "x-pane-id": "%3" } },
      fetch: async (input, init) => handle(new Request(input, init)),
    });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools[0]?.name).toBe("push");
      for (const path of ["first", "second"]) {
        const result = await client.callTool({ name: "push", arguments: { path } });
        expect(result.content).toEqual([{ type: "text", text: `%3:${path}` }]);
      }
    } finally {
      await client.close();
    }
  });

  it("initializes, lists tools, and handles concurrent clients using the same RPC ID", async () => {
    const handle = handler();
    const initialized = await handle(
      request({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      }),
    );
    expect(initialized.status).toBe(200);
    expect((await initialized.json()).result.serverInfo.name).toBe("panopticon");
    const listed = await handle(request({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    expect((await listed.json()).result.tools[0].name).toBe("push");

    const responses = await Promise.all(
      ["%1", "%2"].map((pane) => handle(request(toolCall({ path: pane }), { "x-pane-id": pane }))),
    );
    for (const [index, response] of responses.entries()) {
      expect(response.status).toBe(200);
      const pane = `%${index + 1}`;
      expect((await response.json()).result.content[0].text).toBe(`${pane}:${pane}`);
    }
  });

  it.each([
    undefined,
    "1",
    "100000",
  ])("rejects oversized bodies with Content-Length %s", async (length) => {
    const response = await handler()(
      request(
        toolCall({ path: "x".repeat(65 * 1024) }),
        length ? { "Content-Length": length } : {},
      ),
    );
    expect(response.status).toBe(413);
  });

  it("rejects oversized JSON-RPC batches", async () => {
    const response = await handler()(
      request(Array.from({ length: 101 }, () => toolCall({ path: "ok" }))),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toContain("Batch");
  });

  it("rejects excessive tool argument elements before schema validation", async () => {
    const response = await handler()(request(toolCall({ path: "ok", extra: Array(17).fill(0) })));
    const body = await response.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("maximum of 16 elements");
  });

  it("does not create persistent SSE streams", async () => {
    const response = await handler()(new Request("http://localhost/mcp"));
    expect(response.status).toBe(405);
  });
});
