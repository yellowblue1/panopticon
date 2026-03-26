import { FitAddon, type ILinkProvider, type ITheme, init, Terminal } from "ghostty-web";
import { ArrowDown, ChevronsDown, ChevronsUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";

interface GhosttyTerminalProps {
  content: string | null;
  className?: string;
  isExpanded?: boolean;
  onExpandToggle?: () => void;
  githubRepoUrl?: string | null;
}

const PANOPTICON_THEME: ITheme = {
  background: "#0d1117",
  foreground: "#e6edf3",
  cursor: "#58a6ff",
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
};

/** Singleton WASM init with in-flight dedup */
let initPromise: Promise<void> | null = null;
function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = init();
  }
  return initPromise;
}

/**
 * Create a PR reference link provider that matches #N patterns
 * on the last visible line (status bar) and opens the GitHub PR URL.
 */
function createPrLinkProvider(terminal: Terminal, githubRepoUrl: string): ILinkProvider {
  const prPattern = /#(\d+)/g;
  return {
    provideLinks(y, callback) {
      // Only match PR references on the last visible row (status bar)
      if (y !== terminal.rows - 1) {
        callback(undefined);
        return;
      }
      const line = terminal.buffer.active.getLine(y);
      if (!line) {
        callback(undefined);
        return;
      }
      const text = line.translateToString(false);
      const links: Array<{
        text: string;
        range: {
          start: { x: number; y: number };
          end: { x: number; y: number };
        };
        activate: (event: MouseEvent) => void;
      }> = [];
      let match: RegExpExecArray | null = null;
      // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
      while ((match = prPattern.exec(text)) !== null) {
        const startX = match.index;
        const endX = startX + match[0].length - 1;
        const prNumber = match[1];
        const url = `${githubRepoUrl}/pull/${prNumber}`;
        links.push({
          text: match[0],
          range: { start: { x: startX, y }, end: { x: endX, y } },
          activate: () => window.open(url, "_blank", "noopener,noreferrer"),
        });
      }
      callback(links.length > 0 ? links : undefined);
    },
  };
}

export function GhosttyTerminal({
  content,
  className,
  isExpanded,
  onExpandToggle,
  githubRepoUrl,
}: GhosttyTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [ready, setReady] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const isAtBottomRef = useRef(true);
  const lastRenderedContentRef = useRef<string | null>(null);

  // Initialize WASM and create terminal
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let term: Terminal | null = null;
    let fitAddon: FitAddon | null = null;

    ensureInit()
      .then(() => {
        if (disposed) return;

        term = new Terminal({
          disableStdin: true,
          theme: PANOPTICON_THEME,
          fontSize: 14,
          fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
          scrollback: 500,
          cursorBlink: false,
          cursorStyle: "bar",
        });

        fitAddon = new FitAddon();
        term.loadAddon(fitAddon);

        term.open(container);
        fitAddon.fit();
        fitAddon.observeResize();

        // Track scroll position for auto-scroll behavior
        term.onScroll(() => {
          if (!term) return;
          const viewportY = term.getViewportY();
          // viewportY === 0 means at the bottom in ghostty-web
          const atBottom = viewportY === 0;
          isAtBottomRef.current = atBottom;
          setShowScrollButton(!atBottom);
        });

        terminalRef.current = term;
        fitAddonRef.current = fitAddon;
        setReady(true);
      })
      .catch((err) => {
        console.error("Failed to initialize ghostty-web:", err);
      });

    return () => {
      disposed = true;
      if (fitAddon) fitAddon.dispose();
      if (term) term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      setReady(false);
      lastRenderedContentRef.current = null;
    };
  }, []);

  // Register PR link provider when githubRepoUrl changes
  useEffect(() => {
    const term = terminalRef.current;
    if (!term || !ready || !githubRepoUrl) return;
    const provider = createPrLinkProvider(term, githubRepoUrl);
    term.registerLinkProvider(provider);
    return () => provider.dispose?.();
  }, [githubRepoUrl, ready]);

  // Write content to terminal when it changes
  useEffect(() => {
    const term = terminalRef.current;
    if (!term || !ready || content == null) return;

    // Freeze display when user is scrolled up
    if (!isAtBottomRef.current) {
      lastRenderedContentRef.current ??= content;
      return;
    }

    // Skip if content unchanged
    if (content === lastRenderedContentRef.current) return;
    lastRenderedContentRef.current = content;

    // Reset and write new content
    term.reset();
    term.write(content);
  }, [content, ready]);

  // Re-fit terminal when expand state changes
  useEffect(() => {
    if (!ready) return;
    // Small delay to let CSS transitions complete
    const timer = setTimeout(() => {
      fitAddonRef.current?.fit();
    }, 50);
    return () => clearTimeout(timer);
  }, [isExpanded, ready]);

  const handleScrollToBottom = () => {
    const term = terminalRef.current;
    if (!term) return;
    isAtBottomRef.current = true;
    term.scrollToBottom();
    setShowScrollButton(false);

    // Resume content updates with latest content
    if (content != null && content !== lastRenderedContentRef.current) {
      lastRenderedContentRef.current = content;
      term.reset();
      term.write(content);
    }
  };

  return (
    <div className={cn("relative flex flex-col", className)}>
      <div ref={containerRef} className="absolute inset-0 ghostty-terminal-container" />

      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center text-text-muted">
          Loading terminal...
        </div>
      )}

      {/* Vertical expand toggle */}
      {onExpandToggle && (
        <button
          type="button"
          aria-label={isExpanded ? "Collapse" : "Expand vertically"}
          className={cn(
            "absolute left-3 top-3 z-10",
            "flex items-center justify-center",
            "w-11 h-11 sm:w-9 sm:h-9",
            "rounded-full",
            "shadow-lg shadow-black/30",
            "transition-all duration-200 ease-out",
            "cursor-pointer",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary",
            isExpanded
              ? "bg-accent-blue/20 text-accent-blue border border-accent-blue/50 hover:bg-accent-blue/30"
              : "bg-bg-tertiary/90 backdrop-blur-sm text-text-secondary hover:text-text-primary hover:bg-bg-tertiary border border-border-default",
          )}
          onClick={onExpandToggle}
        >
          {isExpanded ? <ChevronsDown size={16} /> : <ChevronsUp size={16} />}
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
          showScrollButton
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-2 pointer-events-none",
        )}
        onClick={handleScrollToBottom}
        tabIndex={showScrollButton ? 0 : -1}
      >
        <ArrowDown size={18} />
      </button>
    </div>
  );
}
