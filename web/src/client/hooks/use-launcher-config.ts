import type { LauncherConfigData } from "@shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { launcherKeys } from "@/lib/query-keys";
import { launcherApi } from "@/lib/rpc-client";

export function useLauncherConfig() {
  return useQuery({
    queryKey: launcherKeys.config(),
    queryFn: async () => {
      const res = await launcherApi.config.$get();
      return res.json();
    },
    staleTime: 60_000,
  });
}

export function useUpdateLauncherConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (config: LauncherConfigData) => {
      const res = await launcherApi.config.$put({
        json: { config },
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(launcherKeys.config(), data);
      queryClient.invalidateQueries({ queryKey: launcherKeys.projects() });
    },
  });
}
