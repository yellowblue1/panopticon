import type { AuthStatusResponse } from "@shared/types";
import { useQuery } from "@tanstack/react-query";
import { authKeys } from "@/lib/query-keys";
import { authApi } from "@/lib/rpc-client";

export function useAuthStatus() {
  return useQuery({
    queryKey: authKeys.status(),
    queryFn: async (): Promise<AuthStatusResponse> => {
      try {
        const res = await authApi.status.$get();
        if (res.ok) {
          return await res.json();
        }
      } catch (err) {
        console.warn("Failed to check auth status:", err);
      }
      return {
        gcloud_authenticated: false,
        gcp_project_configured: false,
        ai_summary_available: false,
      };
    },
    staleTime: 1000 * 60 * 5,
  });
}
