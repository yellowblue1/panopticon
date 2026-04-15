import type { SlashCommand } from "@shared/types";
import { Search, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/cn";

// --- Fuzzy matching (fzf-style) ---

interface FuzzyMatch {
  score: number;
  indices: number[]; // matched character positions in the text
}

/** fzf-style fuzzy match: characters must appear in order but not contiguously. */
function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  let qi = 0;
  let score = 0;
  const indices: number[] = [];
  let prevIndex = -2;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      indices.push(ti);

      // Consecutive character bonus
      if (ti === prevIndex + 1) score += 8;

      // Word boundary bonus (after /, space, -)
      if (ti === 0 || t[ti - 1] === "/" || t[ti - 1] === " " || t[ti - 1] === "-") score += 12;

      // Earlier position bonus (prefer matches near the start)
      score += Math.max(0, 8 - ti);

      score += 4; // base per-character score
      prevIndex = ti;
      qi++;
    }
  }

  if (qi < q.length) return null;
  return { score, indices };
}

interface ScoredCommand {
  command: SlashCommand;
  score: number;
  /** Matched character indices in the command string (for highlighting). */
  commandIndices: number[];
}

/** Score a command against the query. Matches in command name are weighted 3x over description. */
function scoreCommand(query: string, cmd: SlashCommand): ScoredCommand | null {
  // Try command string first (highest weight)
  const cmdMatch = fuzzyMatch(query, cmd.command);
  if (cmdMatch) {
    return { command: cmd, score: cmdMatch.score * 3, commandIndices: cmdMatch.indices };
  }

  // Try description (lower weight, no command highlighting)
  const descMatch = fuzzyMatch(query, cmd.description);
  if (descMatch) {
    return { command: cmd, score: descMatch.score, commandIndices: [] };
  }

  return null;
}

/** Render text with matched character indices highlighted. */
function HighlightedText({
  text,
  indices,
  className,
  highlightClassName,
}: {
  text: string;
  indices: number[];
  className?: string;
  highlightClassName?: string;
}) {
  if (indices.length === 0) return <span className={className}>{text}</span>;

  const matchSet = new Set(indices);
  const parts: { key: string; text: string; isMatch: boolean }[] = [];
  let run = "";
  let runStart = 0;
  let runIsMatch = false;

  for (let i = 0; i <= text.length; i++) {
    const isMatch = matchSet.has(i);
    if (i === text.length || isMatch !== runIsMatch) {
      if (run) {
        parts.push({ key: `${runStart}-${i}`, text: run, isMatch: runIsMatch });
      }
      run = "";
      runStart = i;
      runIsMatch = isMatch;
    }
    if (i < text.length) run += text[i];
  }

  return (
    <span className={className}>
      {parts.map((part) =>
        part.isMatch ? (
          <span key={part.key} className={highlightClassName}>
            {part.text}
          </span>
        ) : (
          <span key={part.key}>{part.text}</span>
        ),
      )}
    </span>
  );
}

// --- Component ---

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onExecute: (command: string) => void;
  isPending: boolean;
  commands: SlashCommand[];
}

export function CommandPalette({
  isOpen,
  onClose,
  onExecute,
  isPending,
  commands,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const isMobile = useMediaQuery("(max-width: 639px)");

  // Reset state when opening (render-time state adjustment)
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
    }
  }

  // Focus input when opening (legitimate DOM side effect)
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  // Close on Escape at the document level (works even when input is not focused)
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  // Fuzzy filter + sort: alphabetical when no query, by score when searching
  const scoredCommands: ScoredCommand[] = !query
    ? [...commands]
        .sort((a, b) => a.command.localeCompare(b.command))
        .map((cmd) => ({ command: cmd, score: 0, commandIndices: [] }))
    : commands
        .flatMap((cmd) => {
          const scored = scoreCommand(query, cmd);
          return scored ? [scored] : [];
        })
        .sort((a, b) => b.score - a.score);

  // Reset selection when query changes (render-time state adjustment)
  const [prevQuery, setPrevQuery] = useState(query);
  if (query !== prevQuery) {
    setPrevQuery(query);
    setSelectedIndex(0);
  }

  const handleSelect = (cmd: SlashCommand) => {
    onExecute(cmd.command);
    onClose();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.min(selectedIndex + 1, scoredCommands.length - 1);
      setSelectedIndex(next);
      (listRef.current?.children[next] as HTMLElement | undefined)?.scrollIntoView({
        block: "nearest",
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.max(selectedIndex - 1, 0);
      setSelectedIndex(next);
      (listRef.current?.children[next] as HTMLElement | undefined)?.scrollIntoView({
        block: "nearest",
      });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = scoredCommands[selectedIndex];
      if (entry && !isPending) handleSelect(entry.command);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-50 bg-black/50 backdrop-blur-sm",
          "transition-opacity duration-200 ease-out",
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className={cn(
          "fixed z-50 bg-bg-primary border border-border-default shadow-2xl",
          "flex flex-col overflow-hidden",
          "transition-all duration-200 ease-out",
          // Mobile: bottom sheet extending to near top
          isMobile && "inset-x-0 bottom-0 top-12 rounded-t-xl",
          isMobile &&
            (isOpen
              ? "translate-y-0 opacity-100"
              : "translate-y-full opacity-0 pointer-events-none"),
          // Desktop: centered modal
          !isMobile && "top-[20%] left-1/2 -translate-x-1/2 w-full max-w-[480px] rounded-xl",
          !isMobile &&
            (isOpen ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"),
        )}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={() => {}} // Keyboard events handled by document-level listener
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        {/* Mobile drag handle */}
        {isMobile && (
          <div className="flex justify-center pt-2 pb-1">
            <div className="w-10 h-1 rounded-full bg-border-default" />
          </div>
        )}

        {/* Search header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-default">
          <Search size={18} className="text-text-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search commands..."
            className={cn(
              "flex-1 bg-transparent text-text-primary placeholder:text-text-muted",
              "text-base outline-none",
            )}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "shrink-0 flex items-center justify-center",
              "w-8 h-8 rounded-md",
              "text-text-muted hover:text-text-primary hover:bg-bg-tertiary",
              "transition-colors",
            )}
            aria-label="Close command palette"
          >
            <X size={18} />
          </button>
        </div>

        {/* Command list */}
        <div
          ref={listRef}
          className={cn(
            "overflow-y-auto overscroll-contain",
            isMobile ? "flex-1 pb-[max(12px,env(safe-area-inset-bottom))]" : "max-h-[320px]",
          )}
        >
          {scoredCommands.length === 0 ? (
            <div className="px-4 py-6 text-center text-text-muted text-sm">
              No matching commands
            </div>
          ) : (
            scoredCommands.map(({ command: cmd, commandIndices }, i) => (
              <button
                key={cmd.command}
                type="button"
                onClick={() => handleSelect(cmd)}
                disabled={isPending}
                className={cn(
                  "w-full flex items-center gap-3 px-4 text-left",
                  "transition-colors cursor-pointer",
                  "disabled:opacity-40 disabled:cursor-not-allowed",
                  "active:bg-bg-tertiary",
                  isMobile ? "min-h-[48px] py-3" : "min-h-[40px] py-2",
                  i === selectedIndex ? "bg-bg-tertiary" : "hover:bg-bg-secondary",
                )}
              >
                <HighlightedText
                  text={cmd.command}
                  indices={commandIndices}
                  className="font-mono text-sm text-text-muted shrink-0"
                  highlightClassName="text-accent-blue"
                />
                <span className="text-sm text-text-muted truncate">{cmd.description}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
}
