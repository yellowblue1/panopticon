import { useConnection } from "@/contexts/connection-context";
import { cn } from "@/lib/cn";

const statusLabels = {
  connected: "Live",
  polling: "Polling",
  disconnected: "Connecting...",
} as const;

export function ConnectionIndicator() {
  const { status } = useConnection();

  return (
    <div className="flex items-center gap-2.5 text-[0.9375rem] text-text-muted">
      <span className={cn("status-indicator", status)} />
      <span>{statusLabels[status]}</span>
    </div>
  );
}
