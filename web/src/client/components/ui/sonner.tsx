import { Toaster as SonnerToaster } from "sonner";
import { useMediaQuery } from "@/hooks/use-media-query";

export function Toaster() {
  const isMobile = useMediaQuery("(max-width: 639px)");

  return (
    <SonnerToaster
      position={isMobile ? "top-center" : "bottom-right"}
      toastOptions={{
        style: {
          background: "var(--color-bg-tertiary)",
          color: "var(--color-text-primary)",
          border: "1px solid var(--color-border-default)",
        },
      }}
    />
  );
}
