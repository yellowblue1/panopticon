import { useCallback } from "react";
import { toast } from "sonner";

export function useCopyToClipboard() {
  const copy = useCallback(async (text: string, label = "text") => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${label} to clipboard!`);
      return true;
    } catch {
      toast.error(`Failed to copy ${label}`);
      return false;
    }
  }, []);

  return copy;
}
