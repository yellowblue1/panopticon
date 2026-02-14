import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { ArrowDown, ArrowLeftRight, Check, Copy, Maximize, Minimize } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/cn";
import { filterHorizontalBorders, maxContentWidth } from "@/lib/terminal-filters";
import "@xterm/xterm/css/xterm.css";

interface XtermViewerProps {
  content: string | null;
  className?: string;
  isFullscreen?: boolean;
  onFullscreenToggle?: () => void;
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

/** Duration (ms) a touch must be held to trigger text selection. */
const LONG_PRESS_MS = 400;

/** Squared distance (px²) threshold to distinguish a tap/hold from a drag. */
const MOVE_THRESHOLD_SQ = 100;

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

export function XtermViewer({
  content,
  className,
  isFullscreen,
  onFullscreenToggle,
}: XtermViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isMobile = useMediaQuery("(max-width: 639px)");
  const [showButton, setShowButton] = useState(false);
  const [copied, setCopied] = useState(false);
  const isAtBottomRef = useRef(true);
  const [fitWidth, setFitWidth] = useState(false);
  const [contentOverflows, setContentOverflows] = useState(false);
  const maxWidthRef = useRef(0);
  const fitWidthRef = useRef(false);
  fitWidthRef.current = fitWidth;

  // Touch-based text selection state (mobile)
  const [copyBtnPos, setCopyBtnPos] = useState<{ x: number; y: number } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSelectingRef = useRef(false);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const selectionAnchorRef = useRef<{ col: number; row: number } | null>(null);

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
    // stopPropagation on the viewport prevents touch events from bubbling up
    // to xterm's handler on .xterm, while still allowing native scroll
    // (browser handles scrolling at compositor level for any touch inside a
    // scrollable container) and pointer events on .xterm-screen for selection.
    const isMobileAtMount = window.matchMedia("(max-width: 639px)").matches;
    const stopBubble = (e: Event) => e.stopPropagation();
    if (isMobileAtMount && viewport) {
      viewport.addEventListener("touchstart", stopBubble, { passive: true });
      viewport.addEventListener("touchmove", stopBubble, { passive: true });
    }

    // Touch-based text selection: long-press selects a word, drag extends range.
    const screen = container.querySelector<HTMLElement>(".xterm-screen");
    let screenTouchHandlers: (() => void) | null = null;

    if (isMobileAtMount && screen) {
      const getCellFromTouch = (clientX: number, clientY: number) => {
        const rect = screen.getBoundingClientRect();
        const cellWidth = rect.width / terminal.cols;
        const cellHeight = rect.height / terminal.rows;
        const col = Math.max(
          0,
          Math.min(terminal.cols - 1, Math.floor((clientX - rect.left) / cellWidth)),
        );
        const row = Math.max(
          0,
          Math.min(terminal.rows - 1, Math.floor((clientY - rect.top) / cellHeight)),
        );
        return { col, row };
      };

      const selectWordAt = (col: number, viewportRow: number) => {
        const bufferRow = viewportRow + terminal.buffer.active.viewportY;
        const line = terminal.buffer.active.getLine(bufferRow);
        if (!line) return;

        const isWordChar = (c: number): boolean => {
          if (c < 0 || c >= terminal.cols) return false;
          const cell = line.getCell(c);
          if (!cell) return false;
          const ch = cell.getChars();
          return ch.length > 0 && ch !== " " && ch !== "\t";
        };

        if (!isWordChar(col)) return;

        let start = col;
        let end = col;
        while (start > 0 && isWordChar(start - 1)) start--;
        while (end < terminal.cols - 1 && isWordChar(end + 1)) end++;

        terminal.select(start, viewportRow, end - start + 1);
        selectionAnchorRef.current = { col, row: viewportRow };
      };

      const updateSelection = (endCol: number, endRow: number) => {
        const anchor = selectionAnchorRef.current;
        if (!anchor) return;

        let sCol = anchor.col;
        let sRow = anchor.row;
        let eCol = endCol;
        let eRow = endRow;

        if (eRow < sRow || (eRow === sRow && eCol < sCol)) {
          [sCol, sRow, eCol, eRow] = [eCol, eRow, sCol, sRow];
        }

        const length = (eRow - sRow) * terminal.cols + (eCol - sCol + 1);
        terminal.select(sCol, sRow, Math.max(1, length));
      };

      const onTouchStart = (e: TouchEvent) => {
        const touch = e.touches[0];
        touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
        isSelectingRef.current = false;

        longPressTimerRef.current = setTimeout(() => {
          isSelectingRef.current = true;
          navigator.vibrate?.(50);
          const cell = getCellFromTouch(touch.clientX, touch.clientY);
          selectWordAt(cell.col, cell.row);
        }, LONG_PRESS_MS);
      };

      const onTouchMove = (e: TouchEvent) => {
        const touch = e.touches[0];
        const start = touchStartPosRef.current;

        // Cancel long-press if finger moved too far (it's a scroll)
        if (!isSelectingRef.current && start && longPressTimerRef.current) {
          const dx = touch.clientX - start.x;
          const dy = touch.clientY - start.y;
          if (dx * dx + dy * dy > MOVE_THRESHOLD_SQ) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
          }
        }

        // Extend selection while dragging in selection mode
        if (isSelectingRef.current) {
          e.preventDefault();
          const cell = getCellFromTouch(touch.clientX, touch.clientY);
          updateSelection(cell.col, cell.row);
        }
      };

      const onTouchEnd = (e: TouchEvent) => {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }

        if (isSelectingRef.current && terminal.hasSelection()) {
          // Selection complete — show floating copy button
          const touch = e.changedTouches[0];
          const containerRect = container.getBoundingClientRect();
          setCopyBtnPos({
            x: Math.max(
              8,
              Math.min(containerRect.width - 88, touch.clientX - containerRect.left - 40),
            ),
            y: Math.max(8, touch.clientY - containerRect.top - 48),
          });
        } else if (!isSelectingRef.current) {
          // Quick tap — clear any existing selection
          terminal.clearSelection();
          setCopyBtnPos(null);
        }

        isSelectingRef.current = false;
        touchStartPosRef.current = null;
      };

      screen.addEventListener("touchstart", onTouchStart, { passive: true });
      screen.addEventListener("touchmove", onTouchMove, { passive: false });
      screen.addEventListener("touchend", onTouchEnd, { passive: true });

      screenTouchHandlers = () => {
        screen.removeEventListener("touchstart", onTouchStart);
        screen.removeEventListener("touchmove", onTouchMove);
        screen.removeEventListener("touchend", onTouchEnd);
      };
    }

    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      screenTouchHandlers?.();
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
          const contentWidth = maxContentWidth(content);
          setContentOverflows(contentWidth > terminal.cols);

          if (fitWidthRef.current && fitAddon) {
            // fitWidth ON (both mobile & desktop): expand terminal columns
            maxWidthRef.current = contentWidth;
            fitWithOverride(terminal, fitAddon, maxWidthRef.current);
            terminal.write(`\x1b[0m\x1b[H\x1b[2J\x1b[3J${content}`);
          } else if (isMobile) {
            // Mobile, fitWidth OFF: filter horizontal borders
            const processed = filterHorizontalBorders(content, terminal.cols);
            terminal.write(`\x1b[0m\x1b[H\x1b[2J\x1b[3J${processed}`);
          } else {
            // Desktop, fitWidth OFF: write as-is
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

  // Mobile: reprocess content when fitWidth toggles.
  // On desktop, CSS width expansion triggers ResizeObserver which handles the resize.
  // On mobile, the container stays the same width (overflow handles scrolling),
  // so we need to explicitly expand/reset the terminal and rewrite content.
  useEffect(() => {
    if (!isMobile) return;
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon || content == null) return;

    const frameId = requestAnimationFrame(() => {
      try {
        if (fitWidth) {
          const contentWidth = maxContentWidth(content);
          maxWidthRef.current = contentWidth;
          fitWithOverride(terminal, fitAddon, contentWidth);
          terminal.write(`\x1b[0m\x1b[H\x1b[2J\x1b[3J${content}`);
        } else {
          maxWidthRef.current = 0;
          safeFit(fitAddon);
          const processed = filterHorizontalBorders(content, terminal.cols);
          terminal.write(`\x1b[0m\x1b[H\x1b[2J\x1b[3J${processed}`);
        }
        isAtBottomRef.current = true;
        setShowButton(false);
      } catch {
        // Terminal renderer not yet ready
      }
    });
    return () => cancelAnimationFrame(frameId);
  }, [fitWidth, isMobile]);

  const handleScrollToBottom = () => {
    terminalRef.current?.scrollToBottom();
  };

  const handleCopy = async () => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.selectAll();
    const text = terminal.getSelection();
    terminal.clearSelection();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access denied or unavailable (e.g. mobile Safari permissions)
    }
  };

  const handleCopySelection = async () => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const text = terminal.getSelection();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      terminal.clearSelection();
      setCopyBtnPos(null);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access denied or unavailable
    }
  };

  return (
    <div className={cn("relative flex flex-col", fitWidth && "pane-viewer--fit-width", className)}>
      <div
        ref={containerRef}
        className={cn("flex-1 min-h-0", isMobile && fitWidth && "overflow-x-auto")}
      />

      {/* Fullscreen toggle */}
      {onFullscreenToggle && (
        <button
          type="button"
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          className={cn(
            "absolute left-3 top-3 z-10",
            "flex items-center justify-center",
            "w-11 h-11 sm:w-9 sm:h-9",
            "rounded-full",
            "shadow-lg shadow-black/30",
            "transition-all duration-200 ease-out",
            "cursor-pointer",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary",
            isFullscreen
              ? "bg-accent-blue/20 text-accent-blue border border-accent-blue/50 hover:bg-accent-blue/30"
              : "bg-bg-tertiary/90 backdrop-blur-sm text-text-secondary hover:text-text-primary hover:bg-bg-tertiary border border-border-default",
          )}
          onClick={onFullscreenToggle}
        >
          {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
        </button>
      )}

      {/* Fit-width toggle — shown when content overflows or fit-width is active */}
      {(fitWidth || contentOverflows) && (
        <button
          type="button"
          aria-label={
            fitWidth ? "Fit terminal to container width" : "Fit terminal to content width"
          }
          className={cn(
            "absolute right-3 top-3 z-10",
            "flex items-center justify-center",
            "w-11 h-11 sm:w-9 sm:h-9",
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

      {/* Copy terminal content (mobile) */}
      {isMobile && (
        <button
          type="button"
          aria-label={copied ? "Copied" : "Copy terminal content"}
          className={cn(
            "absolute left-3 bottom-3 z-10",
            "flex items-center justify-center",
            "w-11 h-11",
            "rounded-full",
            "shadow-lg shadow-black/30",
            "transition-all duration-200 ease-out",
            "cursor-pointer",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary",
            copied
              ? "bg-green-500/20 text-green-400 border border-green-500/50"
              : "bg-bg-tertiary/90 backdrop-blur-sm text-text-secondary hover:text-text-primary hover:bg-bg-tertiary border border-border-default",
          )}
          onClick={handleCopy}
        >
          {copied ? <Check size={18} /> : <Copy size={18} />}
        </button>
      )}

      {/* Floating copy button — appears near selected text after long-press */}
      {copyBtnPos && (
        <button
          type="button"
          aria-label="Copy selection"
          className={cn(
            "absolute z-20",
            "flex items-center gap-1.5 px-3 py-1.5",
            "rounded-full text-sm font-medium",
            "bg-accent-blue text-white",
            "shadow-lg shadow-black/40",
            "active:scale-95 transition-transform",
          )}
          style={{ left: copyBtnPos.x, top: copyBtnPos.y }}
          onClick={handleCopySelection}
        >
          <Copy size={14} />
          Copy
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
