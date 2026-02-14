import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { ArrowDown, ArrowLeftRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/cn";
import { filterHorizontalBorders, maxContentWidth } from "@/lib/terminal-filters";
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

/** Upper bound for terminal columns to prevent absurd widths from malformed content. */
const MAX_COLS = 500;

function safeFit(fitAddon: FitAddon): void {
  try {
    fitAddon.fit();
  } catch {
    // Renderer dimensions not yet available; will retry on next resize event
  }
}

/**
 * Fit the terminal to its container, widening cols on desktop
 * to accommodate content wider than the container.
 */
function fitWithOverride(terminal: Terminal, fitAddon: FitAddon, maxWidth: number): void {
  try {
    const dims = fitAddon.proposeDimensions();
    if (!dims || Number.isNaN(dims.cols) || Number.isNaN(dims.rows)) return;

    const effectiveCols = Math.min(MAX_COLS, Math.max(dims.cols, maxWidth));
    if (terminal.rows === dims.rows && terminal.cols === effectiveCols) return;
    terminal.resize(effectiveCols, dims.rows);
  } catch {
    // Renderer dimensions not yet available; will retry on next resize event
  }
}

export function XtermViewer({ content, className }: XtermViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isMobile = useMediaQuery("(max-width: 639px)");
  const [showButton, setShowButton] = useState(false);
  const isAtBottomRef = useRef(true);
  const [fitWidth, setFitWidth] = useState(false);
  const [contentOverflows, setContentOverflows] = useState(false);
  const maxWidthRef = useRef(0);
  const fitWidthRef = useRef(false);
  fitWidthRef.current = fitWidth;

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
        if (fitWidthRef.current && maxWidthRef.current > 0) {
          fitWithOverride(terminal, fitAddon, maxWidthRef.current);
        } else {
          safeFit(fitAddon);
        }
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

    // On mobile, bypass xterm's manual touch scrolling to use native scroll.
    // xterm.js attaches touch handlers on .xterm that manually set scrollTop,
    // which bypasses native scroll momentum and causes sticky scrolling.
    // CSS sets pointer-events:none on .xterm-screen so touches reach the
    // viewport (overflow-y:scroll); stopPropagation prevents the event from
    // bubbling to xterm's handler, avoiding double-scroll.
    const isMobileAtMount = window.matchMedia("(max-width: 639px)").matches;
    const stopBubble = (e: Event) => e.stopPropagation();
    if (isMobileAtMount && viewport) {
      viewport.addEventListener("touchstart", stopBubble, { passive: true });
      viewport.addEventListener("touchmove", stopBubble, { passive: true });
    }

    return () => {
      if (isMobileAtMount && viewport) {
        viewport.removeEventListener("touchstart", stopBubble);
        viewport.removeEventListener("touchmove", stopBubble);
      }
      viewport?.removeEventListener("scroll", handleScroll);
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // Re-fit when fitWidth is toggled off — reset to container-fitted dimensions.
  // Toggling ON is handled by the content effect which recalculates width.
  useEffect(() => {
    const fitAddon = fitAddonRef.current;
    if (!fitAddon || fitWidth) return;

    maxWidthRef.current = 0;
    const frameId = requestAnimationFrame(() => safeFit(fitAddon));
    return () => cancelAnimationFrame(frameId);
  }, [fitWidth]);

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

    const fitAddon = fitAddonRef.current;

    const frameId = requestAnimationFrame(() => {
      try {
        if (content != null) {
          if (isMobile) {
            const processed = filterHorizontalBorders(content, terminal.cols);
            terminal.write(`\x1b[0m\x1b[H\x1b[2J\x1b[3J${processed}`);
          } else {
            const contentWidth = maxContentWidth(content);
            setContentOverflows(contentWidth > terminal.cols);
            if (fitWidthRef.current && fitAddon) {
              maxWidthRef.current = contentWidth;
              fitWithOverride(terminal, fitAddon, maxWidthRef.current);
            }
            terminal.write(`\x1b[0m\x1b[H\x1b[2J\x1b[3J${content}`);
          }
        } else {
          maxWidthRef.current = 0;
          setContentOverflows(false);
          terminal.reset();
        }
        isAtBottomRef.current = true;
        setShowButton(false);
      } catch {
        // Terminal renderer not yet ready; content will be written on next update
      }
    });

    return () => cancelAnimationFrame(frameId);
  }, [content, isMobile]);

  const handleScrollToBottom = () => {
    terminalRef.current?.scrollToBottom();
  };

  return (
    <div
      className={cn(
        "relative flex flex-col",
        !isMobile && fitWidth && "pane-viewer--fit-width",
        className,
      )}
    >
      <div ref={containerRef} className="flex-1 min-h-0" />

      {/* Fit-width toggle — desktop only, hidden when content fits */}
      {!isMobile && (fitWidth || contentOverflows) && (
        <button
          type="button"
          aria-label={
            fitWidth ? "Fit terminal to container width" : "Fit terminal to content width"
          }
          className={cn(
            "absolute right-3 top-3 z-10",
            "flex items-center justify-center",
            "w-9 h-9",
            "rounded-full",
            "shadow-lg shadow-black/30",
            "transition-all duration-200 ease-out",
            "cursor-pointer",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary",
            fitWidth
              ? "bg-accent-blue/20 text-accent-blue border border-accent-blue/50 hover:bg-accent-blue/30"
              : "bg-bg-tertiary/90 backdrop-blur-sm text-text-secondary hover:text-text-primary hover:bg-bg-tertiary border border-border-default",
          )}
          onClick={() => setFitWidth((prev) => !prev)}
        >
          <ArrowLeftRight size={16} />
        </button>
      )}

      {/* Scroll to bottom */}
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
