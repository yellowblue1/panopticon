import type { UploadedFile } from "../infrastructure/file-upload";

export interface SendMessageDeps {
  sendKeys: (paneId: string, text: string) => boolean;
  saveFile: (data: ArrayBuffer, originalName: string, mimeType: string) => UploadedFile | null;
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

const MAX_FILES_PER_REQUEST = 5;

export function sendMessage(input: SendMessageInput, deps: SendMessageDeps): SendMessageResult {
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
    const uploaded = deps.saveFile(file.data, file.name, file.type);
    if (!uploaded) {
      return {
        success: false,
        error: `Failed to save file: ${file.name}`,
        uploadedFiles: savedFiles,
      };
    }
    savedFiles.push(uploaded);
  }

  const parts: string[] = [];
  if (trimmedText) {
    parts.push(trimmedText);
  }
  if (savedFiles.length > 0) {
    parts.push(savedFiles.map((f) => f.savedPath).join("\n"));
  }
  const composedText = parts.join("\n\n");

  const success = deps.sendKeys(paneId, composedText);
  if (!success) {
    return {
      success: false,
      error: "Failed to send message to pane",
      uploadedFiles: savedFiles,
    };
  }

  return { success: true, uploadedFiles: savedFiles };
}
