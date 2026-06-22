import type { AgentDialect } from "@shared/types";
import { useQuery } from "@tanstack/react-query";
import { settingsKeys } from "@/lib/query-keys";
import { settingsApi } from "@/lib/rpc-client";

async function fetchSlashCommands(dialect: AgentDialect) {
  const res = await settingsApi["slash-commands"].$get({ query: { dialect } });
  return res.json();
}

export function useSlashCommands(dialect: AgentDialect, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: settingsKeys.slashCommands(dialect),
    queryFn: () => fetchSlashCommands(dialect),
    staleTime: 60_000,
    enabled: options?.enabled ?? true,
  });
}
