import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";

import { useMediaQuery } from "@/hooks/use-media-query";
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
  const isMobile = useMediaQuery("(max-width: 639px)");

  // Initialize terminal on mount
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

    return () => {
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // Write content when it changes — deferred to ensure renderer is initialized
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    const frameId = requestAnimationFrame(() => {
      try {
        if (content != null) {
          const processed = isMobile ? filterHorizontalBorders(content) : content;
          // Overwrite in-place: cursor home → write content → clear remaining lines
          terminal.write(`\x1b[H${processed}\x1b[J`);
        } else {
          terminal.reset();
        }
      } catch {
        // Terminal renderer not yet ready; content will be written on next update
      }
    });

    return () => cancelAnimationFrame(frameId);
  }, [content, isMobile]);

  return <div ref={containerRef} className={className} />;
}
