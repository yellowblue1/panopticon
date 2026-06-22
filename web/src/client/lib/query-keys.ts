import type { AgentDialect } from "@shared/types";

export const sessionKeys = {
  all: ["sessions"] as const,
  lists: () => [...sessionKeys.all, "list"] as const,
};

export const authKeys = {
  all: ["auth"] as const,
  status: () => [...authKeys.all, "status"] as const,
};

export const planKeys = {
  all: ["plans"] as const,
  detail: (paneId: string) => [...planKeys.all, "detail", paneId] as const,
  availability: () => [...planKeys.all, "availability"] as const,
};

export const settingsKeys = {
  all: ["settings"] as const,
  slashCommands: (dialect: AgentDialect) =>
    [...settingsKeys.all, "slash-commands", dialect] as const,
};

export const launcherKeys = {
  all: ["launcher"] as const,
  projects: () => [...launcherKeys.all, "projects"] as const,
  config: () => [...launcherKeys.all, "config"] as const,
  browse: (path: string) => [...launcherKeys.all, "browse", path] as const,
};
