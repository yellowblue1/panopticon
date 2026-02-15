import { Trash2 } from "lucide-react";
import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/cn";

interface PlanViewerProps {
  content: string;
  slug: string;
  onDelete?: () => void;
  isDeleting?: boolean;
}

export function PlanViewer({ content, slug, onDelete, isDeleting }: PlanViewerProps) {
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <div className="plan-viewer">
      <div className="plan-header">
        <span className="plan-slug">{slug}</span>
        {onDelete && (
          <div className="flex items-center gap-2">
            {showConfirm ? (
              <>
                <span className="text-xs text-text-muted">Delete this plan?</span>
                <button
                  type="button"
                  onClick={() => {
                    onDelete();
                    setShowConfirm(false);
                  }}
                  disabled={isDeleting}
                  className={cn(
                    "text-xs px-2 py-1 rounded",
                    "bg-red-500/20 text-red-400 hover:bg-red-500/30",
                    "transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
                  )}
                >
                  {isDeleting ? "Deleting..." : "Confirm"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowConfirm(false)}
                  disabled={isDeleting}
                  className={cn(
                    "text-xs px-2 py-1 rounded",
                    "bg-bg-tertiary text-text-muted hover:text-text-primary",
                    "transition-colors disabled:opacity-40",
                  )}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setShowConfirm(true)}
                className={cn(
                  "p-1.5 rounded",
                  "text-text-muted hover:text-red-400 hover:bg-bg-tertiary",
                  "transition-colors",
                )}
                title="Delete plan"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        )}
      </div>
      <div className="plan-content">
        <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
      </div>
    </div>
  );
}
