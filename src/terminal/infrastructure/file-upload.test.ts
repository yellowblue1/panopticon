import { describe, expect, it, mock } from "bun:test";
import { createFileUploadDeps, type FileUploadFsDeps } from "./file-upload";

function createMockFsDeps(overrides: Partial<FileUploadFsDeps> = {}): FileUploadFsDeps {
  return {
    writeFileSync: mock(() => {}),
    mkdirSync: mock(() => {}),
    existsSync: mock(() => true),
    readdirSync: mock(() => []),
    statSync: mock(() => ({ mtimeMs: 0 })),
    unlinkSync: mock(() => {}),
    tmpdir: () => "/tmp",
    randomHex: () => "abc123",
    now: () => 1700000000000,
    ...overrides,
  };
}

describe("createFileUploadDeps", () => {
  describe("saveFile", () => {
    it("saves a valid image file and returns UploadedFile", () => {
      const fsDeps = createMockFsDeps();
      const deps = createFileUploadDeps(fsDeps);

      const data = new ArrayBuffer(100);
      const result = deps.saveFile(data, "screenshot.png", "image/png");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.file.originalName).toBe("screenshot.png");
        expect(result.file.savedPath).toBe(
          "/tmp/panopticon-uploads/1700000000000-abc123-screenshot.png",
        );
        expect(result.file.mimeType).toBe("image/png");
        expect(result.file.size).toBe(100);
      }
      expect(fsDeps.writeFileSync).toHaveBeenCalledTimes(1);
    });

    it("saves a PDF file", () => {
      const fsDeps = createMockFsDeps();
      const deps = createFileUploadDeps(fsDeps);

      const data = new ArrayBuffer(500);
      const result = deps.saveFile(data, "doc.pdf", "application/pdf");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.file.mimeType).toBe("application/pdf");
      }
    });

    it("rejects files with invalid MIME type and returns reason", () => {
      const fsDeps = createMockFsDeps();
      const deps = createFileUploadDeps(fsDeps);

      const result = deps.saveFile(new ArrayBuffer(100), "script.js", "text/javascript");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("Unsupported file type");
        expect(result.reason).toContain("text/javascript");
      }
      expect(fsDeps.writeFileSync).not.toHaveBeenCalled();
    });

    it("rejects files exceeding 10 MB and returns reason", () => {
      const fsDeps = createMockFsDeps();
      const deps = createFileUploadDeps(fsDeps);

      const largeData = new ArrayBuffer(11 * 1024 * 1024);
      const result = deps.saveFile(largeData, "big.png", "image/png");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("exceeds maximum size");
      }
      expect(fsDeps.writeFileSync).not.toHaveBeenCalled();
    });

    it("sanitizes filenames with path separators", () => {
      const fsDeps = createMockFsDeps();
      const deps = createFileUploadDeps(fsDeps);

      const result = deps.saveFile(new ArrayBuffer(10), "../../etc/passwd", "image/png");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.file.savedPath).not.toContain("../");
        expect(result.file.savedPath).toContain("_etc_passwd");
      }
    });

    it("sanitizes filenames with special characters", () => {
      const fsDeps = createMockFsDeps();
      const deps = createFileUploadDeps(fsDeps);

      const result = deps.saveFile(new ArrayBuffer(10), 'file<name>:"test".png', "image/png");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.file.savedPath).not.toContain("<");
        expect(result.file.savedPath).not.toContain(">");
        expect(result.file.savedPath).not.toContain('"');
      }
    });

    it("sanitizes filenames with whitespace", () => {
      const fsDeps = createMockFsDeps();
      const deps = createFileUploadDeps(fsDeps);

      const result = deps.saveFile(
        new ArrayBuffer(10),
        "Screenshot 2026-04-01 at 9.33.10.png",
        "image/png",
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.file.savedPath).not.toContain(" ");
        expect(result.file.savedPath).toContain("Screenshot_2026-04-01_at_9.33.10.png");
      }
    });

    it("creates upload directory if it does not exist", () => {
      const fsDeps = createMockFsDeps({ existsSync: mock(() => false) });
      const deps = createFileUploadDeps(fsDeps);

      deps.saveFile(new ArrayBuffer(10), "test.png", "image/png");

      expect(fsDeps.mkdirSync).toHaveBeenCalledWith("/tmp/panopticon-uploads", {
        recursive: true,
      });
    });

    it("accepts all allowed MIME types", () => {
      const allowed = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"];
      for (const mime of allowed) {
        const fsDeps = createMockFsDeps();
        const deps = createFileUploadDeps(fsDeps);
        const result = deps.saveFile(new ArrayBuffer(10), "file.ext", mime);
        expect(result.ok).toBe(true);
      }
    });

    it("returns failure reason when writeFileSync throws", () => {
      const fsDeps = createMockFsDeps({
        writeFileSync: mock(() => {
          throw new Error("ENOSPC: disk full");
        }),
      });
      const deps = createFileUploadDeps(fsDeps);

      const result = deps.saveFile(new ArrayBuffer(10), "test.png", "image/png");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("Failed to write file to disk");
      }
    });
  });

  describe("cleanup", () => {
    it("removes files older than 1 hour", () => {
      const now = 1700000000000;
      const oldFileTime = now - 2 * 60 * 60 * 1000; // 2 hours ago
      const fsDeps = createMockFsDeps({
        now: () => now,
        readdirSync: mock(() => ["old-file.png"]),
        statSync: mock(() => ({ mtimeMs: oldFileTime })),
      });
      const deps = createFileUploadDeps(fsDeps);

      deps.cleanup();

      expect(fsDeps.unlinkSync).toHaveBeenCalledWith("/tmp/panopticon-uploads/old-file.png");
    });

    it("preserves recent files", () => {
      const now = 1700000000000;
      const recentTime = now - 10 * 60 * 1000; // 10 minutes ago
      const fsDeps = createMockFsDeps({
        now: () => now,
        readdirSync: mock(() => ["recent-file.png"]),
        statSync: mock(() => ({ mtimeMs: recentTime })),
      });
      const deps = createFileUploadDeps(fsDeps);

      deps.cleanup();

      expect(fsDeps.unlinkSync).not.toHaveBeenCalled();
    });

    it("does nothing if upload directory does not exist", () => {
      const fsDeps = createMockFsDeps({ existsSync: mock(() => false) });
      const deps = createFileUploadDeps(fsDeps);

      deps.cleanup();

      expect(fsDeps.readdirSync).not.toHaveBeenCalled();
    });

    it("handles file removed between readdir and stat gracefully", () => {
      const now = 1700000000000;
      const oldTime = now - 2 * 60 * 60 * 1000;
      const fsDeps = createMockFsDeps({
        now: () => now,
        readdirSync: mock(() => ["vanished-file.png", "still-here.png"]),
        statSync: mock((path: string) => {
          if (path.includes("vanished-file")) throw new Error("ENOENT");
          return { mtimeMs: oldTime };
        }),
      });
      const deps = createFileUploadDeps(fsDeps);

      deps.cleanup();

      expect(fsDeps.unlinkSync).toHaveBeenCalledWith("/tmp/panopticon-uploads/still-here.png");
      expect(fsDeps.unlinkSync).toHaveBeenCalledTimes(1);
    });

    it("handles unlinkSync failure gracefully", () => {
      const now = 1700000000000;
      const oldTime = now - 2 * 60 * 60 * 1000;
      const fsDeps = createMockFsDeps({
        now: () => now,
        readdirSync: mock(() => ["locked.png", "removable.png"]),
        statSync: mock(() => ({ mtimeMs: oldTime })),
        unlinkSync: mock((path: string) => {
          if (path.includes("locked")) throw new Error("EPERM");
        }),
      });
      const deps = createFileUploadDeps(fsDeps);

      deps.cleanup();

      expect(fsDeps.unlinkSync).toHaveBeenCalledTimes(2);
    });
  });

  describe("getUploadDir", () => {
    it("returns the upload directory path", () => {
      const fsDeps = createMockFsDeps();
      const deps = createFileUploadDeps(fsDeps);

      expect(deps.getUploadDir()).toBe("/tmp/panopticon-uploads");
    });
  });
});
