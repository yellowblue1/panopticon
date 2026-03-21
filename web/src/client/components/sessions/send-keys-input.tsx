import { ACCEPTED_FILE_TYPES, MAX_FILE_SIZE, MAX_FILES_PER_REQUEST } from "@shared/constants";
import type { PaneAction } from "@shared/types";
import { Camera, FileText, Paperclip, Send, X } from "lucide-react";
import { type ChangeEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useActionDetection } from "@/hooks/use-action-detection";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useSendKeys } from "@/hooks/use-send-keys";
import { useSendMessage } from "@/hooks/use-send-message";
import { useSlashCommands } from "@/hooks/use-slash-commands";
import { cn } from "@/lib/cn";
import { CommandPalette } from "./command-palette";

interface SendKeysInputProps {
  paneId: string;
}

export function SendKeysInput({ paneId }: SendKeysInputProps) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const sendKeys = useSendKeys();
  const sendMessage = useSendMessage();
  const { action, isDetecting, detect, clear } = useActionDetection(paneId);
  const isMobile = useMediaQuery("(max-width: 639px)");
  const { data: slashCommandsData } = useSlashCommands();
  const slashCommands = slashCommandsData?.commands ?? [];

  const hasText = text.trim().length > 0;
  const hasFiles = files.length > 0;
  const isPending = sendKeys.isPending || sendMessage.isPending;

  // Open command palette with "/" key when no input is focused
  useEffect(() => {
    const handleSlashKey = (e: globalThis.KeyboardEvent) => {
      if (
        e.key === "/" &&
        !isPaletteOpen &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        setIsPaletteOpen(true);
      }
    };
    document.addEventListener("keydown", handleSlashKey);
    return () => document.removeEventListener("keydown", handleSlashKey);
  }, [isPaletteOpen]);

  // Adjust send-keys-bar position when the virtual keyboard opens/closes
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      if (!barRef.current) return;
      // Keyboard height = layout viewport height - visual viewport height
      const offset = window.innerHeight - vv.height - vv.offsetTop;
      barRef.current.style.bottom = `${Math.max(0, offset)}px`;
    };

    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  // Auto-resize textarea to fit content (up to ~5 lines)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  const handleInputFocus = () => {
    const scroll = () => inputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    // Fire twice: once early, once after keyboard animation finishes
    setTimeout(scroll, 100);
    setTimeout(scroll, 400);
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected) return;

    const newFiles = Array.from(selected);
    for (const file of newFiles) {
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name} exceeds 10 MB limit`);
        e.target.value = "";
        return;
      }
    }

    setFiles((prev) => {
      const combined = [...prev, ...newFiles];
      if (combined.length > MAX_FILES_PER_REQUEST) {
        toast.error(`Maximum ${MAX_FILES_PER_REQUEST} files allowed`);
        return prev;
      }
      return combined;
    });

    e.target.value = "";
  };

  const handleRemoveFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed && !hasFiles) return;

    // When files are attached, use multipart upload endpoint
    if (hasFiles) {
      sendMessage.mutate(
        { paneId, text: trimmed, files },
        {
          onSuccess: (data) => {
            setText("");
            setFiles([]);
            inputRef.current?.focus();
            const fileCount = data.uploadedFiles?.length ?? 0;
            toast.success(fileCount > 0 ? `Sent with ${fileCount} file(s)` : `Sent: ${trimmed}`);
          },
        },
      );
      return;
    }

    // If choices are shown with a "Type something" option, select it first
    const typeOption =
      action.type === "choices" ? action.options.find((o) => !o.autoEnter) : undefined;

    if (typeOption) {
      // 1) Send raw key to select "Type something", 2) wait, 3) send text
      clear();
      sendKeys.mutate(
        { paneId, text: typeOption.value, raw: true },
        {
          onSuccess: () => {
            setTimeout(() => {
              sendKeys.mutate(
                { paneId, text: trimmed },
                {
                  onSuccess: () => {
                    setText("");
                    inputRef.current?.focus();
                    toast.success(`Sent: ${trimmed}`);
                  },
                },
              );
            }, 500);
          },
        },
      );
      return;
    }

    sendKeys.mutate(
      { paneId, text: trimmed },
      {
        onSuccess: () => {
          setText("");
          inputRef.current?.focus();
          toast.success(`Sent: ${trimmed}`);
        },
      },
    );
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(text);
    }
    // Typing "/" in an empty textarea (no files) opens the command palette
    if (e.key === "/" && !text && !hasFiles) {
      e.preventDefault();
      setIsPaletteOpen(true);
    }
  };

  /** Send text with Enter (y, n, etc.) and hide action buttons */
  const handleQuickAction = (value: string) => {
    sendKeys.mutate(
      { paneId, text: value },
      {
        onSuccess: () => {
          toast.success(`Sent: ${value}`);
          clear();
          inputRef.current?.focus();
        },
      },
    );
  };
  /** Morphing action button: "/" when empty (opens palette), Send when has content */
  const handleActionButton = () => {
    if (hasText || hasFiles) {
      handleSend(text);
    } else {
      setIsPaletteOpen(true);
    }
  };

  /** Send a raw tmux key name (Escape, i, etc.) without Enter */
  const handleRawKey = (key: string) => {
    sendKeys.mutate(
      { paneId, text: key, raw: true },
      {
        onSuccess: () => {
          inputRef.current?.focus();
          setTimeout(() => {
            inputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 100);
        },
      },
    );
  };

  return (
    <div ref={barRef} className="send-keys-bar">
      {/* Raw key buttons — right-aligned for thumb reachability */}
      <div className="flex items-center gap-2 mb-2 justify-end">
        <button
          type="button"
          className="quick-action-btn !text-xl !leading-none"
          onClick={() => detect()}
          disabled={isDetecting}
          title="Detect actions with AI"
        >
          {isDetecting ? "..." : "\u{1F9E0}"}
        </button>
        {!isMobile && <span className="text-xs text-text-muted">Keys:</span>}
        <button
          type="button"
          className="quick-action-btn"
          onClick={() => handleRawKey("Escape")}
          disabled={isPending}
          title="Send Escape key (vi normal mode)"
        >
          Esc
        </button>
        <button
          type="button"
          className="quick-action-btn"
          onClick={() => handleRawKey("i")}
          disabled={isPending}
          title="Send i key (vi insert mode)"
        >
          i
        </button>
        <button
          type="button"
          className="quick-action-btn"
          onClick={() => handleRawKey("Up")}
          disabled={isPending}
          title="Send Up arrow key"
        >
          ↑
        </button>
        <button
          type="button"
          className="quick-action-btn"
          onClick={() => handleRawKey("Down")}
          disabled={isPending}
          title="Send Down arrow key"
        >
          ↓
        </button>
        <button
          type="button"
          className="quick-action-btn"
          onClick={() => handleRawKey("Enter")}
          disabled={isPending}
          title="Send Enter key"
        >
          Enter
        </button>
      </div>

      {/* Command palette */}
      <CommandPalette
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
        onExecute={(command) => {
          setText(`${command} `);
          requestAnimationFrame(() => {
            const el = inputRef.current;
            if (el) {
              el.focus();
              el.setSelectionRange(el.value.length, el.value.length);
            }
          });
        }}
        isPending={isPending}
        commands={slashCommands}
      />

      {/* Dynamic AI-detected actions */}
      <DynamicActions action={action} onQuickAction={handleQuickAction} isPending={isPending} />

      {/* File preview thumbnails */}
      {hasFiles && (
        <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
          {files.map((file, index) => (
            <FilePreview
              key={`${file.name}-${file.size}-${index}`}
              file={file}
              onRemove={() => handleRemoveFile(index)}
            />
          ))}
        </div>
      )}

      {/* Input row: [attach] [camera?] [textarea] [/ ↔ send] */}
      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isPending}
          className={cn(
            "rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center relative",
            "transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
            hasFiles
              ? "bg-accent-blue/20 text-accent-blue border border-accent-blue"
              : "bg-bg-secondary text-text-secondary border border-border-default hover:text-text-primary hover:bg-bg-tertiary",
          )}
          title="Attach files"
        >
          <Paperclip size={18} />
          {hasFiles && (
            <span className="absolute -top-1.5 -right-1.5 bg-accent-blue text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center leading-none">
              {files.length}
            </span>
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />

        {isMobile && (
          <>
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              disabled={isPending}
              className={cn(
                "rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center",
                "bg-bg-secondary text-text-secondary border border-border-default",
                "hover:text-text-primary hover:bg-bg-tertiary transition-colors",
                "disabled:opacity-40 disabled:cursor-not-allowed",
              )}
              title="Take photo"
            >
              <Camera size={18} />
            </button>
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileSelect}
            />
          </>
        )}

        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleInputFocus}
          enterKeyHint="send"
          rows={1}
          placeholder={
            action.type === "freeform"
              ? action.placeholder
              : action.type === "choices" && action.options.some((o) => !o.autoEnter)
                ? "Type here (auto-selects 'Type something')"
                : hasFiles
                  ? "Add instructions..."
                  : "Send text to terminal..."
          }
          disabled={isPending}
          className={cn(
            "flex-1 bg-bg-secondary border border-border-default rounded-lg px-3 py-2",
            "text-text-primary placeholder:text-text-muted font-mono text-sm",
            "focus:outline-none focus:border-accent-blue transition-colors",
            "min-h-[44px] max-h-[120px] resize-none overflow-y-auto",
          )}
        />
        <button
          type="button"
          onClick={handleActionButton}
          disabled={isPending}
          className={cn(
            "rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center",
            "transition-all duration-200 ease-out",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            hasText || hasFiles
              ? "bg-accent-blue text-white hover:opacity-90"
              : "bg-bg-secondary text-text-secondary border border-border-default hover:text-text-primary hover:bg-bg-tertiary",
          )}
          title={hasText || hasFiles ? "Send message" : "Open command palette (/)"}
        >
          {hasText || hasFiles ? (
            <Send size={18} />
          ) : (
            <span className="font-mono text-base font-bold">/</span>
          )}
        </button>
      </div>
    </div>
  );
}

/** Renders a thumbnail preview for an attached file */
function FilePreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const isImage = file.type.startsWith("image/");
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage) return;
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);

  return (
    <div className="file-preview">
      {isImage && src ? (
        <img src={src} alt={file.name} />
      ) : (
        <div className="file-preview-pdf">
          <FileText size={16} />
          <span className="truncate w-full text-center">{file.name.split(".").pop()}</span>
        </div>
      )}
      <button type="button" className="file-preview-remove" onClick={onRemove}>
        <X size={12} />
      </button>
    </div>
  );
}

/** Renders dynamic buttons based on AI-detected action type */
function DynamicActions({
  action,
  onQuickAction,
  isPending,
}: {
  action: PaneAction;
  onQuickAction: (value: string) => void;
  isPending: boolean;
}) {
  if (action.type === "none") return null;

  if (action.type === "yesno") {
    return (
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-text-muted">Answer:</span>
        <button
          type="button"
          className="quick-action-btn"
          onClick={() => onQuickAction("y")}
          disabled={isPending}
        >
          Yes
        </button>
        <button
          type="button"
          className="quick-action-btn"
          onClick={() => onQuickAction("n")}
          disabled={isPending}
        >
          No
        </button>
      </div>
    );
  }

  if (action.type === "choices") {
    // Hide "Type something" options — handled automatically by the text input
    const visibleOptions = action.options.filter((o) => o.autoEnter);
    if (visibleOptions.length === 0) return null;

    return (
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-xs text-text-muted">Options:</span>
        {visibleOptions.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className="quick-action-btn"
            onClick={() => onQuickAction(opt.value)}
            disabled={isPending}
          >
            {opt.label}
          </button>
        ))}
      </div>
    );
  }

  // "freeform" type: placeholder is set on the input, no extra buttons needed
  return null;
}
