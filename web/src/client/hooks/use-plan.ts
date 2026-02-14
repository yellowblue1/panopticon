import type { PlanResponse } from "@shared/types";
import { useQuery } from "@tanstack/react-query";
import { planKeys } from "@/lib/query-keys";
import { sessionsApi } from "@/lib/rpc-client";

async function fetchPlan(paneId: string): Promise<PlanResponse> {
  const res = await sessionsApi[":pane_id"].plan.$get({
    param: { pane_id: encodeURIComponent(paneId) },
  });
  if (!res.ok) throw new Error("Failed to fetch plan");
  return await res.json();
}

export function usePlan(paneId: string) {
  return useQuery({
    queryKey: planKeys.detail(paneId),
    queryFn: () => fetchPlan(paneId),
    staleTime: 30_000,
  });
}
