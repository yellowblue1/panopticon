import { FolderOpen } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { useBrowsePath } from "@/hooks/use-browse-path";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { cn } from "@/lib/cn";

interface PathAutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

function extractBrowsePrefix(input: string): string {
  if (input === "~") return "~/";
  if (input.endsWith("/")) return input;
  const lastSlash = input.lastIndexOf("/");
  if (lastSlash === -1) return "";
  return input.slice(0, lastSlash + 1);
}

export function PathAutocompleteInput({
  value,
  onChange,
  placeholder,
}: PathAutocompleteInputProps) {
  const listboxId = useId();
  const debouncedValue = useDebouncedValue(value, 300);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { data } = useBrowsePath(debouncedValue);
  const entries = data?.entries ?? [];

  // Reset selection when debounced query changes (render-time reset)
  const prevDebouncedRef = useRef(debouncedValue);
  if (prevDebouncedRef.current !== debouncedValue) {
    prevDebouncedRef.current = debouncedValue;
    setSelectedIndex(0);
  }

  // Derived visibility: user intent + data availability
  const showDropdown = isOpen && entries.length > 0 && debouncedValue.length > 0;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (entryName: string) => {
    const prefix = extractBrowsePrefix(value);
    const newValue = `${prefix}${entryName}/`;
    onChange(newValue);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.min(selectedIndex + 1, entries.length - 1);
      setSelectedIndex(next);
      (listRef.current?.children[next] as HTMLElement | undefined)?.scrollIntoView({
        block: "nearest",
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = Math.max(selectedIndex - 1, 0);
      setSelectedIndex(prev);
      (listRef.current?.children[prev] as HTMLElement | undefined)?.scrollIntoView({
        block: "nearest",
      });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = entries[selectedIndex];
      if (entry) handleSelect(entry.name);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    } else if (e.key === "Tab" && entries.length > 0) {
      e.preventDefault();
      const entry = entries[selectedIndex];
      if (entry) handleSelect(entry.name);
    }
  };

  return (
    <div ref={containerRef} className="relative flex-1">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={listboxId}
        aria-activedescendant={showDropdown ? `${listboxId}-option-${selectedIndex}` : undefined}
        className={cn(
          "w-full bg-bg-primary border border-border-default rounded px-2 py-1.5",
          "text-sm font-mono text-text-primary placeholder:text-text-muted",
          "focus:outline-none focus:border-accent-blue transition-colors",
        )}
      />
      {showDropdown && (
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          className={cn(
            "absolute left-0 right-0 top-full mt-1 z-20",
            "bg-bg-secondary border border-border-default rounded-md shadow-lg",
            "max-h-[200px] overflow-y-auto overscroll-contain",
          )}
        >
          {entries.map((entry, i) => (
            <button
              key={entry.path}
              type="button"
              id={`${listboxId}-option-${i}`}
              role="option"
              aria-selected={i === selectedIndex}
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(entry.name);
              }}
              onMouseEnter={() => setSelectedIndex(i)}
              className={cn(
                "w-full flex items-center gap-2 px-2.5 min-h-[44px] text-left",
                "text-sm font-mono transition-colors cursor-pointer",
                i === selectedIndex ? "bg-bg-tertiary text-text-primary" : "text-text-secondary",
              )}
            >
              <FolderOpen size={14} className="shrink-0 text-text-muted" />
              {entry.name}/
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
