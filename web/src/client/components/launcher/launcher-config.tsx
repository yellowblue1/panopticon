import { Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useLauncherConfig, useUpdateLauncherConfig } from "@/hooks/use-launcher-config";
import { cn } from "@/lib/cn";
import { PathAutocompleteInput } from "./path-autocomplete-input";

interface ScanPathEntry {
  id: string;
  value: string;
}

let nextId = 0;
function createEntry(value: string): ScanPathEntry {
  return { id: String(nextId++), value };
}

export function LauncherConfig() {
  const { data, isLoading } = useLauncherConfig();
  const updateMutation = useUpdateLauncherConfig();
  const [scanPaths, setScanPaths] = useState<ScanPathEntry[]>([]);
  const [useGhq, setUseGhq] = useState(true);
  const [isDirty, setIsDirty] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (data && "config" in data && !initialized.current) {
      setScanPaths(data.config.scanPaths.map(createEntry));
      setUseGhq(data.config.useGhq);
      initialized.current = true;
    }
  }, [data]);

  const handlePathChange = (id: string, value: string) => {
    setScanPaths((prev) => prev.map((entry) => (entry.id === id ? { ...entry, value } : entry)));
    setIsDirty(true);
  };

  const handleAddPath = () => {
    setScanPaths((prev) => [...prev, createEntry("")]);
    setIsDirty(true);
  };

  const handleRemovePath = (id: string) => {
    setScanPaths((prev) => prev.filter((entry) => entry.id !== id));
    setIsDirty(true);
  };

  const handleGhqToggle = () => {
    setUseGhq((prev) => !prev);
    setIsDirty(true);
  };

  const handleSave = () => {
    const filtered = scanPaths.filter((entry) => entry.value.trim().length > 0);
    updateMutation.mutate(
      { scanPaths: filtered.map((entry) => entry.value), useGhq },
      {
        onSuccess: () => {
          setScanPaths(filtered);
          setIsDirty(false);
          toast.success("Launcher config saved");
        },
        onError: () => {
          toast.error("Failed to save config");
        },
      },
    );
  };

  if (isLoading) {
    return <div className="text-sm text-text-muted py-4">Loading config...</div>;
  }

  return (
    <div className="mb-6 p-4 rounded-lg bg-bg-secondary border border-border-default">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-text-primary">Scan Paths</h3>
        <button
          type="button"
          onClick={handleAddPath}
          className={cn(
            "flex items-center gap-1.5 text-xs px-2.5 py-1.5",
            "bg-bg-tertiary border border-border-default rounded-md",
            "text-text-secondary hover:text-text-primary transition-colors",
          )}
        >
          <Plus size={12} />
          Add path
        </button>
      </div>

      <p className="text-xs text-text-muted mb-3">
        Directories to scan for projects (immediate subdirectories). Use ~ for home directory.
      </p>

      <div className="space-y-2 mb-3">
        {scanPaths.map((entry) => (
          <div key={entry.id} className="flex items-center gap-2">
            <PathAutocompleteInput
              value={entry.value}
              onChange={(v) => handlePathChange(entry.id, v)}
              placeholder="~/src"
            />
            <button
              type="button"
              onClick={() => handleRemovePath(entry.id)}
              className={cn(
                "shrink-0 p-1.5 rounded",
                "text-text-muted hover:text-red-400 hover:bg-bg-tertiary transition-colors",
              )}
              title="Remove path"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {scanPaths.length === 0 && (
          <p className="text-xs text-text-muted py-2">
            No scan paths configured. Add one to discover projects.
          </p>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer mb-3">
        <input
          type="checkbox"
          checked={useGhq}
          onChange={handleGhqToggle}
          className="accent-accent-blue"
        />
        Include ghq-managed repositories
      </label>

      {isDirty && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium",
              "bg-accent-blue text-white hover:opacity-90",
              "transition-opacity disabled:opacity-40 disabled:cursor-not-allowed",
            )}
          >
            <Save size={14} />
            {updateMutation.isPending ? "Saving..." : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
