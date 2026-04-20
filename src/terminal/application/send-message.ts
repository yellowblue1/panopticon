import { isImageMimeType, MAX_FILES_PER_REQUEST } from "../../shared/constants";
import type { SaveFileResult, UploadedFile } from "../infrastructure/file-upload";

/**
 * Delay after `tmux paste-buffer -p` before sending subsequent literal keys.
 *
 * Without this delay, characters sent immediately after a bracketed paste are
 * absorbed by Claude Code as part of the paste payload (the terminating
 * `ESC[201~` has not yet been processed by the client), which causes trailing
 * text to vanish from the message. 50 ms is empirically sufficient on a
 * local loopback; 0 ms reliably loses the text. We keep it small so perceived
 * UX stays snappy.
 */
const POST_PASTE_FLUSH_MS = 50;

export interface SendMessageDeps {
  pastePath: (paneId: string, content: string) => boolean;
  sendLiteral: (paneId: string, text: string) => boolean;
  sendEnter: (paneId: string) => boolean;
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
    const isImage = isImageMimeType(file.mimeType);
    const ok = isImage
      ? deps.pastePath(paneId, file.savedPath)
      : deps.sendLiteral(paneId, file.savedPath);
    if (!ok) return fail();
    // Bracketed paste needs a beat to finish flushing through the terminal
    // emulator before we append more keys, otherwise Claude Code absorbs the
    // next literal as part of the paste payload and drops it.
    if (isImage) await deps.sleep(POST_PASTE_FLUSH_MS);
    hasPart = true;
  }

  if (trimmedText) {
    if (hasPart && !deps.sendLiteral(paneId, " ")) return fail();
    if (!deps.sendLiteral(paneId, trimmedText)) return fail();
  }

  if (!deps.sendEnter(paneId)) return fail();

  return { success: true, uploadedFiles: savedFiles };
}
