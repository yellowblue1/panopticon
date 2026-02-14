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
        ai_summary_available: false,
        gemini_auth_error: false,
        gemini_backend: null,
      };
    },
    staleTime: 1000 * 30, // 30s — auth errors can appear/disappear at runtime
  });
}
