import type { PullRequestsResponse } from "@shared/types";
import { useQuery } from "@tanstack/react-query";
import { prKeys } from "@/lib/query-keys";
import { sessionsApi } from "@/lib/rpc-client";

async function fetchPullRequests(): Promise<PullRequestsResponse> {
  const res = await sessionsApi.prs.$get();
  if (!res.ok) throw new Error("Failed to fetch pull requests");
  return await res.json();
}

export function usePullRequests() {
  return useQuery({
    queryKey: prKeys.availability(),
    queryFn: fetchPullRequests,
    staleTime: 120_000,
    refetchInterval: 120_000,
  });
}
