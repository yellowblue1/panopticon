import { isImageMimeType, MAX_FILES_PER_REQUEST } from "../../shared/constants";
import type { SaveFileResult, UploadedFile } from "../infrastructure/file-upload";

export interface SendMessageDeps {
  pastePath: (paneId: string, content: string) => boolean;
  sendLiteral: (paneId: string, text: string) => boolean;
  sendEnter: (paneId: string) => boolean;
  saveFile: (data: ArrayBuffer, originalName: string, mimeType: string) => SaveFileResult;
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

/**
 * Send text and optional files to a tmux pane as a single CLI message.
 *
 * Partial-failure contract: if any tmux primitive (`pastePath`, `sendLiteral`,
 * `sendEnter`) fails mid-compose, the function returns `{ success: false }`
 * immediately and does NOT attempt to roll back what was already written to
 * the pane's input buffer. Any bracketed-paste placeholders (e.g. `[Image
 * #N]`) and literal text written before the failure will remain in the
 * pane's input line without a trailing Enter. Callers are expected to
 * surface the error to the user (e.g. via a toast) so they can manually
 * clear the input (C-u / C-c) and retry. Rollback is deliberately omitted
 * because tmux exposes no atomic way to undo a paste-buffer insertion and a
 * best-effort C-u could clobber pre-existing input the user had typed.
 */
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

  // Images use bracketed paste so Claude Code's input handler converts them
  // into [Image #N] attachments; PDFs (and any non-image) stay as literal
  // paths because bracketed paste does not trigger that conversion for them,
  // and Claude Code opens them via its Read tool on submit anyway. The whole
  // payload is composed into one line and finished with a single Enter so
  // the CLI treats it as one message.
  const fail = (): SendMessageResult => ({
    success: false,
    error: "Failed to send to pane",
    uploadedFiles: savedFiles,
  });

  let hasPart = false;
  for (const file of savedFiles) {
    if (hasPart && !deps.sendLiteral(paneId, " ")) return fail();
    const ok = isImageMimeType(file.mimeType)
      ? deps.pastePath(paneId, file.savedPath)
      : deps.sendLiteral(paneId, file.savedPath);
    if (!ok) return fail();
    hasPart = true;
  }

  if (trimmedText) {
    if (hasPart && !deps.sendLiteral(paneId, " ")) return fail();
    if (!deps.sendLiteral(paneId, trimmedText)) return fail();
  }

  if (!deps.sendEnter(paneId)) return fail();

  return { success: true, uploadedFiles: savedFiles };
}
