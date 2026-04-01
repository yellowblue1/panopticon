import { MAX_FILES_PER_REQUEST } from "../../shared/constants";
import type { SaveFileResult, UploadedFile } from "../infrastructure/file-upload";

// CLIs like Claude Code only detect image paths when they arrive as standalone
// inputs (with Enter). When files and text are sent together, this delay gives
// the CLI time to process file inputs before the text arrives.
const FILE_INPUT_DELAY_MS = 500;

export interface SendMessageDeps {
  sendKeys: (paneId: string, text: string) => boolean;
  saveFile: (data: ArrayBuffer, originalName: string, mimeType: string) => SaveFileResult;
  sleep: (ms: number) => Promise<void>;
}

interface SendMessageInput {
  readonly paneId: string;
  readonly text: string;
  readonly files: ReadonlyArray<{
    readonly data: ArrayBuffer;
    readonly name: string;
    readonly type: string;
  }>;
}

export interface SendMessageResult {
  readonly success: boolean;
  readonly error?: string;
  readonly uploadedFiles: readonly UploadedFile[];
}

export async function sendMessage(
  input: SendMessageInput,
  deps: SendMessageDeps,
): Promise<SendMessageResult> {
  const { paneId, text, files } = input;
  const trimmedText = text.trim();

  if (!trimmedText && files.length === 0) {
    return { success: false, error: "Must provide text or files", uploadedFiles: [] };
  }

  if (files.length > MAX_FILES_PER_REQUEST) {
    return {
      success: false,
      error: `Maximum ${MAX_FILES_PER_REQUEST} files allowed`,
      uploadedFiles: [],
    };
  }

  const savedFiles: UploadedFile[] = [];
  for (const file of files) {
    const result = deps.saveFile(file.data, file.name, file.type);
    if (!result.ok) {
      return {
        success: false,
        error: `Failed to save file: ${file.name} (${result.reason})`,
        uploadedFiles: savedFiles,
      };
    }
    savedFiles.push(result.file);
  }

  for (const file of savedFiles) {
    if (!deps.sendKeys(paneId, file.savedPath)) {
      return {
        success: false,
        error: "Failed to send file path to pane",
        uploadedFiles: savedFiles,
      };
    }
  }

  if (trimmedText) {
    if (savedFiles.length > 0) {
      await deps.sleep(FILE_INPUT_DELAY_MS);
    }
    if (!deps.sendKeys(paneId, trimmedText)) {
      return {
        success: false,
        error: "Failed to send text to pane",
        uploadedFiles: savedFiles,
      };
    }
  }

  return { success: true, uploadedFiles: savedFiles };
}
