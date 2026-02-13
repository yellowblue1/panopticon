import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { ArrowDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { filterHorizontalBorders } from "@/lib/terminal-filters";
import "@xterm/xterm/css/xterm.css";

interface XtermViewerProps {
  content: string | null;
  className?: string;
}

// GitHub Dark theme matching existing CSS custom properties
const XTERM_THEME = {
  background: "#0d1117",
  foreground: "#c9d1d9",
  cursor: "#0d1117",
  cursorAccent: "#0d1117",
  selectionBackground: "#264f78",
  selectionForeground: "#f0f6fc",
  black: "#586069",
  red: "#f85149",
  green: "#3fb950",
  yellow: "#d29922",
  blue: "#58a6ff",
  magenta: "#bc8cff",
  cyan: "#39c5cf",
  white: "#f0f6fc",
  brightBlack: "#8b949e",
  brightRed: "#ff7b72",
  brightGreen: "#56d364",
  brightYellow: "#e3b341",
  brightBlue: "#79c0ff",
  brightMagenta: "#d2a8ff",
  brightCyan: "#56d4dd",
  brightWhite: "#ffffff",
} as const;

/** Pixel tolerance for "at bottom" detection in the xterm viewport. */
const SCROLL_BOTTOM_THRESHOLD_PX = 10;

function safeFit(fitAddon: FitAddon): void {
  try {
    fitAddon.fit();
  } catch {
    // Renderer dimensions not yet available; will retry on next resize event
  }
}

export function XtermViewer({ content, className }: XtermViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [showButton, setShowButton] = useState(false);
  const isAtBottomRef = useRef(true);

  // Initialize terminal and scroll listener on mount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const fitAddon = new FitAddon();
    const terminal = new Terminal({
      theme: XTERM_THEME,
      fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: false,
      cursorStyle: "block",
      cursorInactiveStyle: "none",
      disableStdin: true,
      convertEol: true,
      scrollback: 1000,
    });

    terminal.loadAddon(fitAddon);
    terminal.open(container);

    // Prevent mobile virtual keyboard from appearing on tap.
    // This viewer is read-only; the actual input is in SendKeysInput.
    if (terminal.textarea) {
      terminal.textarea.inputMode = "none";
    }

    // Defer fit to next animation frame so the renderer finishes initializing
    requestAnimationFrame(() => {
      safeFit(fitAddon);
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        safeFit(fitAddon);
      });
    });
    resizeObserver.observe(container);

    // Track scroll position via native DOM events on .xterm-viewport.
    // terminal.onScroll doesn't fire reliably on mobile touch scrolling.
    const viewport = container.querySelector<HTMLElement>(".xterm-viewport");
    const handleScroll = () => {
      if (!viewport) return;
      const atBottom =
        viewport.scrollTop + viewport.clientHeight >=
        viewport.scrollHeight - SCROLL_BOTTOM_THRESHOLD_PX;
      isAtBottomRef.current = atBottom;
      setShowButton(!atBottom);
    };
    viewport?.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      viewport?.removeEventListener("scroll", handleScroll);
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // Write content when it changes — deferred to ensure renderer is initialized.
  // Uses escape sequences instead of terminal.reset() to avoid flicker:
  // reset() is synchronous (instant blank) while write() is async, causing
  // a visible flash on mobile with frequent updates.
  // Skips updates when user is scrolled up to prevent viewport jumping;
  // latest content is applied on the next update after returning to bottom.
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    // Don't disrupt the user's reading position — defer until they return to bottom
    if (!isAtBottomRef.current && content != null) return;

    const frameId = requestAnimationFrame(() => {
      try {
        if (content != null) {
          const processed = filterHorizontalBorders(content, terminal.cols);
          // Reset attributes, move to home, clear screen + scrollback, then write —
          // all in one write() call so xterm.js renders them in a single paint.
          terminal.write(`\x1b[0m\x1b[H\x1b[2J\x1b[3J${processed}`);
        } else {
          terminal.reset();
        }
        isAtBottomRef.current = true;
        setShowButton(false);
      } catch {
        // Terminal renderer not yet ready; content will be written on next update
      }
    });

    return () => cancelAnimationFrame(frameId);
  }, [content]);

  const handleScrollToBottom = () => {
    terminalRef.current?.scrollToBottom();
  };

  return (
    <div className={cn("relative flex flex-col", className)}>
      <div ref={containerRef} className="flex-1 min-h-0" />
      <button
        type="button"
        aria-label="Scroll to bottom"
        className={cn(
          "absolute right-3 bottom-3 z-10",
          "flex items-center justify-center",
          "w-11 h-11 sm:w-9 sm:h-9",
          "rounded-full",
          "bg-bg-tertiary/90 backdrop-blur-sm",
          "border border-border-default",
          "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary",
          "shadow-lg shadow-black/30",
          "transition-all duration-200 ease-out",
          "cursor-pointer",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary",
          showButton ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none",
        )}
        onClick={handleScrollToBottom}
        tabIndex={showButton ? 0 : -1}
      >
        <ArrowDown size={18} />
      </button>
    </div>
  );
}
