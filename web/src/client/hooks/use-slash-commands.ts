import { useQuery } from "@tanstack/react-query";
import { settingsKeys } from "@/lib/query-keys";
import { settingsApi } from "@/lib/rpc-client";

async function fetchSlashCommands() {
  const res = await settingsApi["slash-commands"].$get();
  return res.json();
}

export function useSlashCommands() {
  return useQuery({
    queryKey: settingsKeys.slashCommands(),
    queryFn: fetchSlashCommands,
    staleTime: 60_000,
  });
}
