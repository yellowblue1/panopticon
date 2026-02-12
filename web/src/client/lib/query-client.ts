import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Number.POSITIVE_INFINITY, // SSE is the sole freshness driver
      gcTime: 1000 * 60 * 30,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});
