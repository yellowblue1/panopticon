import type { PaneAction } from "@shared/types";
import { Send } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useActionDetection } from "@/hooks/use-action-detection";
import { useSendKeys } from "@/hooks/use-send-keys";
import { cn } from "@/lib/cn";

interface SendKeysInputProps {
  paneId: string;
}

export function SendKeysInput({ paneId }: SendKeysInputProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const sendKeys = useSendKeys();
  const { action, isDetecting, detect, clear } = useActionDetection(paneId);

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

  const handleSend = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

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

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    handleSend(text);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(text);
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

  /** Send a raw tmux key name (Escape, i, etc.) without Enter */
  const handleRawKey = (key: string, label: string) => {
    sendKeys.mutate(
      { paneId, text: key, raw: true },
      {
        onSuccess: () => {
          toast.success(`Sent: ${label}`);
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
      {/* Raw key buttons + AI detect (always visible) */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-xs text-text-muted">Keys:</span>
        <button
          type="button"
          className="quick-action-btn"
          onClick={() => handleRawKey("Escape", "Esc")}
          disabled={sendKeys.isPending}
          title="Send Escape key (vi normal mode)"
        >
          Esc
        </button>
        <button
          type="button"
          className="quick-action-btn"
          onClick={() => handleRawKey("i", "i")}
          disabled={sendKeys.isPending}
          title="Send i key (vi insert mode)"
        >
          i
        </button>
        <button
          type="button"
          className="quick-action-btn"
          onClick={() => handleRawKey("Up", "↑")}
          disabled={sendKeys.isPending}
          title="Send Up arrow key"
        >
          ↑
        </button>
        <button
          type="button"
          className="quick-action-btn"
          onClick={() => handleRawKey("Down", "↓")}
          disabled={sendKeys.isPending}
          title="Send Down arrow key"
        >
          ↓
        </button>
        <button
          type="button"
          className="quick-action-btn"
          onClick={() => handleRawKey("Enter", "Enter")}
          disabled={sendKeys.isPending}
          title="Send Enter key"
        >
          Enter
        </button>
        <button
          type="button"
          className="quick-action-btn !text-xl !leading-none"
          onClick={() => detect()}
          disabled={isDetecting}
          title="Detect actions with AI"
        >
          {isDetecting ? "..." : "\u{1F9E0}"}
        </button>
      </div>

      {/* Dynamic AI-detected actions */}
      <DynamicActions
        action={action}
        onQuickAction={handleQuickAction}
        isPending={sendKeys.isPending}
      />

      {/* Input row */}
      <form onSubmit={handleFormSubmit} className="flex items-end gap-2">
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
                : "Send text to pane..."
          }
          disabled={sendKeys.isPending}
          className={cn(
            "flex-1 bg-bg-secondary border border-border-default rounded-lg px-3 py-2",
            "text-text-primary placeholder:text-text-muted font-mono text-sm",
            "focus:outline-none focus:border-accent-blue transition-colors",
            "min-h-[44px] max-h-[120px] resize-none overflow-y-auto",
          )}
        />
        <button
          type="submit"
          disabled={sendKeys.isPending || !text.trim()}
          className={cn(
            "action-btn bg-accent-blue text-white rounded-lg min-h-[44px] min-w-[44px]",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            "hover:opacity-90 transition-opacity",
          )}
          title="Send text to pane"
        >
          <Send size={18} />
        </button>
      </form>
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
