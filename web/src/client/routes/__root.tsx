import { QueryClientProvider } from "@tanstack/react-query";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { ConnectionIndicator } from "@/components/ui/connection-indicator";
import { Toaster } from "@/components/ui/sonner";
import { ConnectionProvider } from "@/contexts/connection-context";
import { queryClient } from "@/lib/query-client";

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: RootErrorBoundary,
  notFoundComponent: NotFoundPage,
});

function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider>
        <div className="font-sans bg-bg-primary text-text-primary min-h-screen text-base leading-relaxed">
          <div className="max-w-[1400px] mx-auto p-6 max-md:p-4">
            <header className="flex justify-between items-center mb-6 pb-4 border-b border-border-default max-md:flex-wrap max-md:gap-3">
              <div className="flex items-center gap-6">
                <h1 className="text-[1.75rem] font-semibold text-text-primary max-md:text-2xl">
                  <Link to="/" className="no-underline text-inherit">
                    Claude Monitoring
                  </Link>
                </h1>
                <nav className="flex items-center gap-4 text-sm text-text-muted">
                  <Link
                    to="/"
                    className="hover:text-text-primary transition-colors [&.active]:text-accent-blue"
                  >
                    Sessions
                  </Link>
                  <Link
                    to="/settings"
                    className="hover:text-text-primary transition-colors [&.active]:text-accent-blue"
                  >
                    Settings
                  </Link>
                </nav>
              </div>
              <ConnectionIndicator />
            </header>
            <main>
              <Outlet />
            </main>
          </div>
        </div>
        <Toaster />
      </ConnectionProvider>
    </QueryClientProvider>
  );
}

function RootErrorBoundary({ error, reset }: ErrorComponentProps) {
  return (
    <div className="font-sans bg-bg-primary text-text-primary min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-accent-red mb-4">Something went wrong</h1>
        <p className="text-text-muted mb-4">
          {error instanceof Error ? error.message : "An unexpected error occurred"}
        </p>
        <button type="button" className="copy-btn" onClick={reset}>
          Try again
        </button>
      </div>
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="empty-state">
      <p>Page not found</p>
      <p className="hint">
        <Link to="/">Go back to dashboard</Link>
      </p>
    </div>
  );
}
