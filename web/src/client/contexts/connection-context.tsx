import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

export type ConnectionStatus = "connected" | "polling" | "disconnected";

interface ConnectionContextValue {
  status: ConnectionStatus;
  setStatus: (status: ConnectionStatus) => void;
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const value = useMemo(() => ({ status, setStatus }), [status]);

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnection(): ConnectionContextValue {
  const context = useContext(ConnectionContext);
  if (!context) {
    throw new Error("useConnection must be used within a ConnectionProvider");
  }
  return context;
}
