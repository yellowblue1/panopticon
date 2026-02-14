import { FancyAnsi } from "fancy-ansi";
import { ArrowDown, ArrowLeftRight, Maximize, Minimize } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/cn";
import { filterHorizontalBorders, maxContentWidth } from "@/lib/terminal-filters";

interface TerminalViewerProps {
  content: string | null;
  className?: string;
  isFullscreen?: boolean;
  onFullscreenToggle?: () => void;
}

/** Pixel tolerance for "at bottom" detection in the scroll container. */
const SCROLL_BOTTOM_THRESHOLD_PX = 10;

/** Approximate width of a monospace character at 14px font-size. */
const CHAR_WIDTH_PX = 7.8;

/** Singleton converter instance (stateless, safe to reuse). */
const converter = new FancyAnsi();

/**
 * Estimate the number of character columns that fit in the container,
 * accounting for 12px padding on each side.
 */
function estimateCols(containerWidth: number): number {
  return Math.floor((containerWidth - 24) / CHAR_WIDTH_PX);
}

export function TerminalViewer({
  content,
  className,
  isFullscreen,
  onFullscreenToggle,
}: TerminalViewerProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isMobile = useMediaQuery("(max-width: 639px)");
  const [showButton, setShowButton] = useState(false);
  const isAtBottomRef = useRef(true);
  const [fitWidth, setFitWidth] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);

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

  // Track container width via ResizeObserver for overflow detection
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Auto-scroll to bottom when content changes (if user is at bottom)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || content == null) return;

    if (!isAtBottomRef.current) return;

    const frameId = requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });

    return () => cancelAnimationFrame(frameId);
  }, [content]);

  // Determine the effective content to render:
  // freeze display when user is scrolled up, resume on return to bottom
  const effectiveContent = isAtBottomRef.current ? content : lastRenderedContentRef.current;
  if (isAtBottomRef.current && content != null) {
    lastRenderedContentRef.current = content;
  }

  // Compute derived values from effective content
  const cols = estimateCols(containerWidth);
  const contentWidth = effectiveContent != null ? maxContentWidth(effectiveContent) : 0;
  const contentOverflows = effectiveContent != null && contentWidth > cols;

  let processedHtml: string | null = null;
  if (effectiveContent != null) {
    let processed = effectiveContent;
    if (!fitWidth && isMobile) {
      processed = filterHorizontalBorders(effectiveContent, cols);
    }
    processedHtml = converter.toHtml(processed);
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
        className={cn("flex-1 min-h-0 overflow-y-auto", isMobile && fitWidth && "overflow-x-auto")}
      >
        {processedHtml != null ? (
          <pre className="terminal-content" dangerouslySetInnerHTML={{ __html: processedHtml }} />
        ) : null}
      </div>

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
