import { DEFAULT_SLASH_COMMANDS } from "@shared/default-slash-commands";
import type { SlashCommand } from "@shared/types";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useSlashCommands, useUpdateSlashCommands } from "@/hooks/use-slash-commands";
import { cn } from "@/lib/cn";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { data, isLoading } = useSlashCommands();
  const updateMutation = useUpdateSlashCommands();
  const [draft, setDraft] = useState<SlashCommand[]>([]);
  const [isDirty, setIsDirty] = useState(false);

  // Sync server state to draft on first load
  useEffect(() => {
    if (data?.commands) {
      setDraft(data.commands);
      setIsDirty(false);
    }
  }, [data]);

  const updateDraft = (newDraft: SlashCommand[]) => {
    setDraft(newDraft);
    setIsDirty(true);
  };

  const handleChange = (index: number, field: keyof SlashCommand, value: string) => {
    const target = sortedDraft[index];
    const updated = draft.map((cmd) => (cmd === target ? { ...cmd, [field]: value } : cmd));
    setDraft(updated);
    setIsDirty(true);
  };

  const handleDelete = (index: number) => {
    const target = sortedDraft[index];
    updateDraft(draft.filter((cmd) => cmd !== target));
  };

  const handleAdd = () => {
    updateDraft([...draft, { command: "/", description: "" }]);
  };

  const handleReset = () => {
    updateMutation.mutate(DEFAULT_SLASH_COMMANDS, {
      onSuccess: () => {
        setIsDirty(false);
        toast.success("Reset to default commands");
      },
    });
  };

  const handleSave = () => {
    // Validate
    for (const cmd of draft) {
      if (!cmd.command.startsWith("/")) {
        toast.error(`Command "${cmd.command}" must start with /`);
        return;
      }
      if (!cmd.command.trim() || cmd.command.trim() === "/") {
        toast.error("Command name cannot be empty");
        return;
      }
      if (!cmd.description.trim()) {
        toast.error(`Description for "${cmd.command}" cannot be empty`);
        return;
      }
    }

    // Check duplicates
    const seen = new Set<string>();
    for (const cmd of draft) {
      if (seen.has(cmd.command)) {
        toast.error(`Duplicate command: ${cmd.command}`);
        return;
      }
      seen.add(cmd.command);
    }

    updateMutation.mutate(draft, {
      onSuccess: () => {
        setIsDirty(false);
        toast.success("Slash commands saved");
      },
    });
  };

  // Sort alphabetically for display
  const sortedDraft = [...draft].sort((a, b) => a.command.localeCompare(b.command));

  return (
    <>
      <title>Settings - Panopticon</title>
      <div className="mb-4">
        <Link to="/" className="text-accent-blue hover:underline text-sm">
          &larr; Back to sessions
        </Link>
      </div>

      <div className="max-w-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-primary">Slash Commands</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReset}
              disabled={updateMutation.isPending}
              className={cn(
                "flex items-center gap-1.5 text-xs px-3 py-1.5",
                "bg-bg-secondary border border-border-default rounded-md",
                "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary",
                "transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
              )}
            >
              <RotateCcw size={14} />
              Reset to defaults
            </button>
            <button
              type="button"
              onClick={handleAdd}
              className={cn(
                "flex items-center gap-1.5 text-xs px-3 py-1.5",
                "bg-bg-secondary border border-border-default rounded-md",
                "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary",
                "transition-colors",
              )}
            >
              <Plus size={14} />
              Add command
            </button>
          </div>
        </div>

        <p className="text-sm text-text-muted mb-4">
          Configure the slash commands available in the command palette. Commands are sent to the
          active terminal session.
        </p>

        {isLoading ? (
          <div className="text-center py-8 text-text-muted text-sm">Loading...</div>
        ) : (
          <>
            <div className="space-y-2">
              {sortedDraft.map((cmd, i) => (
                <div
                  key={cmd.command}
                  className={cn(
                    "flex items-center gap-2 p-2 rounded-lg",
                    "bg-bg-secondary border border-border-default",
                  )}
                >
                  {/* Command input */}
                  <input
                    type="text"
                    value={cmd.command}
                    onChange={(e) => handleChange(i, "command", e.target.value)}
                    placeholder="/command"
                    className={cn(
                      "w-36 shrink-0 bg-bg-primary border border-border-default rounded px-2 py-1.5",
                      "text-sm font-mono text-text-primary placeholder:text-text-muted",
                      "focus:outline-none focus:border-accent-blue transition-colors",
                    )}
                  />

                  {/* Description input */}
                  <input
                    type="text"
                    value={cmd.description}
                    onChange={(e) => handleChange(i, "description", e.target.value)}
                    placeholder="Description"
                    className={cn(
                      "flex-1 bg-bg-primary border border-border-default rounded px-2 py-1.5",
                      "text-sm text-text-primary placeholder:text-text-muted",
                      "focus:outline-none focus:border-accent-blue transition-colors",
                    )}
                  />

                  {/* Delete button */}
                  <button
                    type="button"
                    onClick={() => handleDelete(i)}
                    className={cn(
                      "shrink-0 p-1.5 rounded",
                      "text-text-muted hover:text-red-400 hover:bg-bg-tertiary",
                      "transition-colors",
                    )}
                    title="Remove command"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            {draft.length === 0 && (
              <div className="text-center py-8 text-text-muted text-sm">
                No commands configured. Add one or reset to defaults.
              </div>
            )}

            {/* Save button */}
            {isDirty && (
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={updateMutation.isPending}
                  className={cn(
                    "px-4 py-2 rounded-lg text-sm font-medium",
                    "bg-accent-blue text-white hover:opacity-90",
                    "transition-opacity disabled:opacity-40 disabled:cursor-not-allowed",
                  )}
                >
                  {updateMutation.isPending ? "Saving..." : "Save Changes"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
