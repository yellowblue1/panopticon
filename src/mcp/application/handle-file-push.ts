import { basename, extname } from "node:path";
import type { FilePushSseEvent } from "../../shared/types";
import type { McpFilePushDeps } from "../domain/ports";
import type { FilePushRequest, FilePushResult } from "../domain/types";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".json": "application/json",
  ".html": "text/html",
  ".css": "text/css",
  ".csv": "text/csv",
  ".xml": "application/xml",
  ".zip": "application/zip",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
};

export function detectMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_MAP[ext] ?? "application/octet-stream";
}

export function handleFilePush(request: FilePushRequest, deps: McpFilePushDeps): FilePushResult {
  const size = deps.getFileSize(request.filePath);
  if (size < 0) {
    return {
      success: false,
      filename: request.filename ?? basename(request.filePath),
      mimeType: "application/octet-stream",
      size: 0,
      error: `File not found: ${request.filePath}`,
    };
  }

  if (size > MAX_FILE_SIZE) {
    return {
      success: false,
      filename: request.filename ?? basename(request.filePath),
      mimeType: "application/octet-stream",
      size,
      error: `File exceeds maximum size of ${MAX_FILE_SIZE / (1024 * 1024)} MB`,
    };
  }

  const data = deps.readFile(request.filePath);
  if (data === null) {
    return {
      success: false,
      filename: request.filename ?? basename(request.filePath),
      mimeType: "application/octet-stream",
      size: 0,
      error: `Failed to read file: ${request.filePath}`,
    };
  }

  const filename = request.filename ?? basename(request.filePath);
  const mimeType = detectMimeType(request.filePath);
  const base64 = data.toString("base64");

  const event: FilePushSseEvent = {
    type: "file_push",
    filename,
    mimeType,
    size: data.length,
    sessionId: request.sessionId ?? null,
    timestamp: Date.now(),
    base64,
  };

  deps.broadcastFilePush(event);

  return {
    success: true,
    filename,
    mimeType,
    size: data.length,
  };
}
