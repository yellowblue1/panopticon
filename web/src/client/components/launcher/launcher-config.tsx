import { Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useLauncherConfig, useUpdateLauncherConfig } from "@/hooks/use-launcher-config";
import { cn } from "@/lib/cn";

export function LauncherConfig() {
  const { data, isLoading } = useLauncherConfig();
  const updateMutation = useUpdateLauncherConfig();
  const [scanPaths, setScanPaths] = useState<string[]>([]);
  const [useGhq, setUseGhq] = useState(true);
  const [isDirty, setIsDirty] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (data && "config" in data && !initialized.current) {
      setScanPaths(data.config.scanPaths);
      setUseGhq(data.config.useGhq);
      initialized.current = true;
    }
  }, [data]);

  const handlePathChange = (index: number, value: string) => {
    setScanPaths((prev) => prev.map((p, i) => (i === index ? value : p)));
    setIsDirty(true);
  };

  const handleAddPath = () => {
    setScanPaths((prev) => [...prev, ""]);
    setIsDirty(true);
  };

  const handleRemovePath = (index: number) => {
    setScanPaths((prev) => prev.filter((_, i) => i !== index));
    setIsDirty(true);
  };

  const handleGhqToggle = () => {
    setUseGhq((prev) => !prev);
    setIsDirty(true);
  };

  const handleSave = () => {
    const filtered = scanPaths.filter((p) => p.trim().length > 0);
    updateMutation.mutate(
      { scanPaths: filtered, useGhq },
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
        {scanPaths.map((path, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              type="text"
              value={path}
              onChange={(e) => handlePathChange(index, e.target.value)}
              placeholder="~/src"
              className={cn(
                "flex-1 bg-bg-primary border border-border-default rounded px-2 py-1.5",
                "text-sm font-mono text-text-primary placeholder:text-text-muted",
                "focus:outline-none focus:border-accent-blue transition-colors",
              )}
            />
            <button
              type="button"
              onClick={() => handleRemovePath(index)}
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
