import type { SessionsApiResponse } from "@shared/types";
import { useQuery } from "@tanstack/react-query";
import { sessionKeys } from "@/lib/query-keys";
import { sessionsApi } from "@/lib/rpc-client";

export const fetchSessions = async (): Promise<SessionsApiResponse> => {
  const res = await sessionsApi.$get();
  if (!res.ok) throw new Error("Failed to fetch sessions");
  return await res.json();
};

export function useSessionsQuery() {
  return useQuery({
    queryKey: sessionKeys.lists(),
    queryFn: fetchSessions,
  });
}
