import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface UploadedFile {
  readonly originalName: string;
  readonly savedPath: string;
  readonly mimeType: string;
  readonly size: number;
}

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
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

export interface FileUploadDeps {
  saveFile: (data: ArrayBuffer, originalName: string, mimeType: string) => UploadedFile | null;
  cleanup: () => void;
  getUploadDir: () => string;
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, "_")
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

  function saveFile(
    data: ArrayBuffer,
    originalName: string,
    mimeType: string,
  ): UploadedFile | null {
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return null;
    }

    if (data.byteLength > MAX_FILE_SIZE) {
      return null;
    }

    ensureUploadDir();

    const sanitized = sanitizeFilename(originalName);
    const filename = `${fsDeps.now()}-${fsDeps.randomHex()}-${sanitized}`;
    const savedPath = join(uploadDir, filename);

    fsDeps.writeFileSync(savedPath, Buffer.from(data));

    return {
      originalName,
      savedPath,
      mimeType,
      size: data.byteLength,
    };
  }

  function cleanup(): void {
    if (!fsDeps.existsSync(uploadDir)) return;

    const cutoff = fsDeps.now() - CLEANUP_MAX_AGE_MS;
    const files = fsDeps.readdirSync(uploadDir);

    for (const file of files) {
      const filePath = join(uploadDir, file);
      const stat = fsDeps.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        fsDeps.unlinkSync(filePath);
      }
    }
  }

  return {
    saveFile,
    cleanup,
    getUploadDir: () => uploadDir,
  };
}
