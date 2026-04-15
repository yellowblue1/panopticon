import type { FilePushSseEvent, UrlPushSseEvent } from "../../shared/types";

export interface McpFilePushDeps {
  readonly readFile: (path: string) => Buffer | null;
  readonly getFileSize: (path: string) => number;
  readonly broadcastFilePush: (event: FilePushSseEvent) => void;
}

export interface McpUrlPushDeps {
  readonly broadcastUrlPush: (event: UrlPushSseEvent) => void;
}

export interface McpConfigDeps {
  readonly readFile: (path: string) => string | null;
  readonly writeFile: (path: string, content: string) => void;
  readonly removeFile: (path: string) => void;
  readonly fileExists: (path: string) => boolean;
  readonly claudeJsonPath: string;
  readonly oldMcpJsonPath: string;
}
