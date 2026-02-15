import { FancyAnsi } from "fancy-ansi";
import { ArrowDown, ArrowLeftRight, ChevronsDown, ChevronsUp } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { linkifyHtml } from "@/lib/linkify-html";
import {
  type CharWidthInfo,
  filterHorizontalBorders,
  maxContentWidth,
} from "@/lib/terminal-filters";

interface TerminalViewerProps {
  content: string | null;
  className?: string;
  isExpanded?: boolean;
  onExpandToggle?: () => void;
  githubRepoUrl?: string | null;
}

/** Pixel tolerance for "at bottom" detection in the scroll container. */
const SCROLL_BOTTOM_THRESHOLD_PX = 10;

/** Fallback character width if measurement fails. */
const DEFAULT_CHAR_WIDTH_PX = 8.4;

/** Singleton converter instance (stateless, safe to reuse). */
const converter = new FancyAnsi();

/** CSS for the terminal font used in measurement spans. */
const TERMINAL_FONT_CSS =
  "position:absolute;visibility:hidden;white-space:pre;" +
  "font-family:ui-monospace,SFMono-Regular,'SF Mono',Menlo,monospace;" +
  "font-size:14px";

/**
 * Measure character widths for regular ASCII and box-drawing characters.
 * On some platforms (e.g. Android), the monospace font may not include
 * box-drawing glyphs, causing fallback to a wider font.
 * Returns both widths so the border filter can adjust for mixed-content lines.
 */
function measureCharWidths(container: HTMLElement): CharWidthInfo {
  const span = document.createElement("span");
  span.style.cssText = TERMINAL_FONT_CSS;
  container.appendChild(span);

  // Measure regular ASCII character
  span.textContent = "M".repeat(50);
  const ascii = span.getBoundingClientRect().width / 50;

  // Measure box-drawing character (U+2500 ─) which may use a fallback font
  span.textContent = "\u2500".repeat(50);
  const border = span.getBoundingClientRect().width / 50;

  container.removeChild(span);

  return {
    ascii: ascii > 0 ? ascii : DEFAULT_CHAR_WIDTH_PX,
    border: border > 0 ? border : DEFAULT_CHAR_WIDTH_PX,
  };
}

/**
 * Calculate the number of character columns that fit in the container,
 * accounting for 12px padding on each side. Subtracts a 2-column safety
 * margin to absorb cumulative sub-pixel rounding in character placement
 * across different devices and rendering engines.
 */
function calcCols(containerWidth: number, charWidth: number): number {
  if (containerWidth <= 24) return 0;
  return Math.max(0, Math.floor((containerWidth - 24) / charWidth) - 2);
}

export function TerminalViewer({
  content,
  className,
  isExpanded,
  onExpandToggle,
  githubRepoUrl,
}: TerminalViewerProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showButton, setShowButton] = useState(false);
  const isAtBottomRef = useRef(true);
  const [fitWidth, setFitWidth] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const charWidthsRef = useRef<CharWidthInfo>({
    ascii: DEFAULT_CHAR_WIDTH_PX,
    border: DEFAULT_CHAR_WIDTH_PX,
  });

  // Track the last rendered content so we can freeze display when scrolled up
  const lastRenderedContentRef = useRef<string | null>(null);

  // Track scroll position on the scroll container
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const atBottom =
        container.scrollTop + container.clientHeight >=
        container.scrollHeight - SCROLL_BOTTOM_THRESHOLD_PX;
      isAtBottomRef.current = atBottom;
      setShowButton(!atBottom);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  // Track container width via ResizeObserver for overflow detection.
  // Also measure actual monospace character width on first observation.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    let measured = false;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (!measured) {
          charWidthsRef.current = measureCharWidths(container);
          measured = true;
        }
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Auto-scroll to bottom when content changes (if user is at bottom).
  // useLayoutEffect fires synchronously after DOM mutations but before paint,
  // ensuring the scroll position is correct before the user sees anything.
  // Depends on both content AND containerWidth because the rendered HTML changes
  // when containerWidth updates (mobile border filtering uses cols derived from it).
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || content == null) return;

    if (!isAtBottomRef.current) return;

    container.scrollTop = container.scrollHeight;
  }, [content, containerWidth]);

  // Determine the effective content to render:
  // freeze display when user is scrolled up, resume on return to bottom
  const effectiveContent = isAtBottomRef.current ? content : lastRenderedContentRef.current;
  if (isAtBottomRef.current && content != null) {
    lastRenderedContentRef.current = content;
  }

  // Compute derived values from effective content
  const charWidths = charWidthsRef.current;
  const maxCharWidth = Math.max(charWidths.ascii, charWidths.border);
  const cols = calcCols(containerWidth, maxCharWidth);
  const contentWidth = effectiveContent != null ? maxContentWidth(effectiveContent) : 0;
  const contentOverflows = effectiveContent != null && contentWidth > cols;

  let processedHtml: string | null = null;
  if (effectiveContent != null) {
    let processed = effectiveContent;
    if (!fitWidth) {
      processed = filterHorizontalBorders(effectiveContent, cols, charWidths);
    }
    processedHtml = linkifyHtml(converter.toHtml(processed), githubRepoUrl);
  }

  const handleScrollToBottom = () => {
    const container = scrollContainerRef.current;
    if (container) {
      // Resume tracking by resetting isAtBottom
      isAtBottomRef.current = true;
      lastRenderedContentRef.current = content;
      container.scrollTop = container.scrollHeight;
      setShowButton(false);
    }
  };

  return (
    <div className={cn("relative flex flex-col", fitWidth && "pane-viewer--fit-width", className)}>
      <div
        ref={scrollContainerRef}
        className={cn(
          "absolute inset-0 overflow-y-auto",
          fitWidth ? "overflow-x-auto" : "overflow-x-hidden",
        )}
      >
        {/* Safe: fancy-ansi escapes all text via escape-html; source is server-controlled tmux output */}
        {processedHtml != null ? (
          <pre className="terminal-content" dangerouslySetInnerHTML={{ __html: processedHtml }} />
        ) : null}
      </div>

      {/* Vertical expand toggle */}
      {onExpandToggle && (
        <button
          type="button"
          aria-label={isExpanded ? "Collapse" : "Expand vertically"}
          className={cn(
            "absolute left-3 top-3 z-0",
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

      {/* Fit-width toggle — shown when content overflows or fit-width is active */}
      {(fitWidth || contentOverflows) && (
        <button
          type="button"
          aria-label={
            fitWidth ? "Fit terminal to container width" : "Fit terminal to content width"
          }
          className={cn(
            "absolute right-3 top-3 z-0",
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

      {/* Scroll to bottom */}
      <button
        type="button"
        aria-label="Scroll to bottom"
        className={cn(
          "absolute right-3 bottom-3 z-0",
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
