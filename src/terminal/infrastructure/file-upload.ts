import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ALLOWED_MIME_TYPES as ALLOWED_MIME_TYPES_LIST,
  MAX_FILE_SIZE,
} from "../../shared/constants";

export interface UploadedFile {
  readonly originalName: string;
  readonly savedPath: string;
  readonly mimeType: string;
  readonly size: number;
}

export type SaveFileResult =
  | { readonly ok: true; readonly file: UploadedFile }
  | { readonly ok: false; readonly reason: string };

const ALLOWED_MIME_TYPES: Set<string> = new Set(ALLOWED_MIME_TYPES_LIST);

const CLEANUP_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
const UPLOAD_DIR_NAME = "panopticon-uploads";

export interface FileUploadFsDeps {
  writeFileSync: (path: string, data: Buffer) => void;
  mkdirSync: (path: string, options: { recursive: boolean }) => void;
  existsSync: (path: string) => boolean;
  readdirSync: (path: string) => string[];
  statSync: (path: string) => { mtimeMs: number };
  unlinkSync: (path: string) => void;
  tmpdir: () => string;
  randomHex: () => string;
  now: () => number;
}

interface FileUploadDeps {
  saveFile: (data: ArrayBuffer, originalName: string, mimeType: string) => SaveFileResult;
  cleanup: () => void;
  getUploadDir: () => string;
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|\s]/g, "_")
    .replace(/\.{2,}/g, ".")
    .slice(-100);
}

function createDefaultFsDeps(): FileUploadFsDeps {
  return {
    writeFileSync,
    mkdirSync,
    existsSync,
    readdirSync,
    statSync,
    unlinkSync,
    tmpdir,
    randomHex: () => Math.random().toString(36).slice(2, 10),
    now: () => Date.now(),
  };
}

export function createFileUploadDeps(
  fsDeps: FileUploadFsDeps = createDefaultFsDeps(),
): FileUploadDeps {
  const uploadDir = join(fsDeps.tmpdir(), UPLOAD_DIR_NAME);

  function ensureUploadDir(): void {
    if (!fsDeps.existsSync(uploadDir)) {
      fsDeps.mkdirSync(uploadDir, { recursive: true });
    }
  }

  function saveFile(data: ArrayBuffer, originalName: string, mimeType: string): SaveFileResult {
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return { ok: false, reason: `Unsupported file type: ${mimeType}` };
    }

    if (data.byteLength > MAX_FILE_SIZE) {
      return { ok: false, reason: `File exceeds maximum size of ${MAX_FILE_SIZE} bytes` };
    }

    ensureUploadDir();

    const sanitized = sanitizeFilename(originalName);
    const filename = `${fsDeps.now()}-${fsDeps.randomHex()}-${sanitized}`;
    const savedPath = join(uploadDir, filename);

    try {
      fsDeps.writeFileSync(savedPath, Buffer.from(data));
    } catch {
      return { ok: false, reason: "Failed to write file to disk" };
    }

    return {
      ok: true,
      file: { originalName, savedPath, mimeType, size: data.byteLength },
    };
  }

  function cleanup(): void {
    if (!fsDeps.existsSync(uploadDir)) return;

    const cutoff = fsDeps.now() - CLEANUP_MAX_AGE_MS;
    const files = fsDeps.readdirSync(uploadDir);

    for (const file of files) {
      try {
        const filePath = join(uploadDir, file);
        const stat = fsDeps.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fsDeps.unlinkSync(filePath);
        }
      } catch {
        // File may have been removed between readdir and stat/unlink; skip safely
      }
    }
  }

  return {
    saveFile,
    cleanup,
    getUploadDir: () => uploadDir,
  };
}
