import type { UrlPushSseEvent } from "../../shared/types";
import type { McpUrlPushDeps } from "../domain/ports";
import type { UrlPushRequest, UrlPushResult } from "../domain/types";

export function handleUrlPush(request: UrlPushRequest, deps: McpUrlPushDeps): UrlPushResult {
  let parsed: URL;
  try {
    parsed = new URL(request.url);
  } catch {
    return {
      success: false,
      url: request.url,
      error: "Invalid URL",
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      success: false,
      url: request.url,
      error: `Unsupported protocol: ${parsed.protocol}`,
    };
  }

  const event: UrlPushSseEvent = {
    type: "url_push",
    url: request.url,
    label: request.label ?? null,
    sessionId: request.sessionId,
    timestamp: Date.now(),
  };

  deps.broadcastUrlPush(event);

  return {
    success: true,
    url: request.url,
  };
}
