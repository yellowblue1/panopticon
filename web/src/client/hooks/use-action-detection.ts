import type { PaneAction, PaneActionsResponse } from "@shared/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { actionKeys } from "@/lib/query-keys";

const DEFAULT_ACTION: PaneAction = { type: "none" };

async function fetchActions(paneId: string): Promise<PaneAction> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(paneId)}/actions`);
  if (!res.ok) return DEFAULT_ACTION;
  const data: PaneActionsResponse = await res.json();
  return data.action;
}

/**
 * Detects pane actions using Gemini, triggered manually by user click.
 * Returns a `detect` function that the user invokes via the wand button.
 * Results persist until the user triggers detection again or `clear` is called.
 */
export function useActionDetection(paneId: string) {
  const queryClient = useQueryClient();
  const queryKey = actionKeys.detect(paneId);
  const query = useQuery({
    queryKey,
    queryFn: () => fetchActions(paneId),
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return {
    action: query.data ?? DEFAULT_ACTION,
    isDetecting: query.isFetching,
    detect: () => query.refetch(),
    clear: () => queryClient.setQueryData(queryKey, DEFAULT_ACTION),
  };
}
