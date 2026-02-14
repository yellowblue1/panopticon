export const sessionKeys = {
  all: ["sessions"] as const,
  lists: () => [...sessionKeys.all, "list"] as const,
};

export const authKeys = {
  all: ["auth"] as const,
  status: () => [...authKeys.all, "status"] as const,
};

export const actionKeys = {
  all: ["actions"] as const,
  detect: (paneId: string) => [...actionKeys.all, "detect", paneId] as const,
};

export const planKeys = {
  all: ["plans"] as const,
  detail: (paneId: string) => [...planKeys.all, "detail", paneId] as const,
  availability: () => [...planKeys.all, "availability"] as const,
};
