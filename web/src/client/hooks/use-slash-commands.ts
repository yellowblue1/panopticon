import type { SlashCommand } from "@shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export function useUpdateSlashCommands() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (commands: SlashCommand[]) => {
      const res = await settingsApi["slash-commands"].$put({
        json: { commands },
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(settingsKeys.slashCommands(), data);
    },
  });
}
