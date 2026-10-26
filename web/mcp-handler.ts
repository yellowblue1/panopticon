import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

/** Stateless MCP requests carry paths and URLs, never the pushed file's contents. */
export function createMcpHandler(registerTools: (server: McpServer) => void) {
  return async (request: Request): Promise<Response> => {
    // This endpoint has no server-initiated messages or persistent sessions.
    if (request.method === "GET") {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
    }

    // A fresh server and transport isolate concurrent clients with identical RPC IDs.
    const server = new McpServer(
      { name: "panopticon", version: "0.1.0" },
      { maxToolInputElements: 16 },
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: 64 * 1024,
    });
    registerTools(server);
    try {
      await server.connect(transport);
      return await transport.handleRequest(request);
    } finally {
      await server.close();
    }
  };
}
