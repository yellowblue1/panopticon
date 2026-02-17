import { useQuery } from "@tanstack/react-query";
import { launcherKeys } from "@/lib/query-keys";
import { launcherApi } from "@/lib/rpc-client";

export function useBrowsePath(path: string) {
  return useQuery({
    queryKey: launcherKeys.browse(path),
    queryFn: async () => {
      const res = await launcherApi.browse.$get({ query: { path } });
      return res.json();
    },
    enabled: path.length > 0,
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  });
}
