import type { PlansAvailabilityResponse } from "@shared/types";
import { useQuery } from "@tanstack/react-query";
import { planKeys } from "@/lib/query-keys";
import { sessionsApi } from "@/lib/rpc-client";

async function fetchPlansAvailability(): Promise<PlansAvailabilityResponse> {
  const res = await sessionsApi.plans.$get();
  if (!res.ok) throw new Error("Failed to fetch plans availability");
  return await res.json();
}

export function usePlansAvailability() {
  return useQuery({
    queryKey: planKeys.availability(),
    queryFn: fetchPlansAvailability,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
