import { useQuery } from "@tanstack/react-query";
import { launcherKeys } from "@/lib/query-keys";
import { launcherApi } from "@/lib/rpc-client";

export function useProjects() {
  return useQuery({
    queryKey: launcherKeys.projects(),
    queryFn: async () => {
      const res = await launcherApi.projects.$get();
      return res.json();
    },
    staleTime: 30_000,
  });
}
