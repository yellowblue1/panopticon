import type { FilePushSseEvent } from "../../shared/types";

export interface McpFilePushDeps {
  readonly readFile: (path: string) => Buffer | null;
  readonly getFileSize: (path: string) => number;
  readonly broadcastFilePush: (event: FilePushSseEvent) => void;
}
