import type { AuthStatusResponse } from "@shared/types";
import { useState } from "react";

const AUTH_DISMISSED_KEY = "panopticon-auth-warning-dismissed";

function getWarningMessage(authStatus: AuthStatusResponse): string | null {
  if (authStatus.ai_summary_available) return null;
  if (!authStatus.gcloud_authenticated) {
    return "AI summaries unavailable: Run <code>gcloud auth login</code> to enable.";
  }
  if (!authStatus.gcp_project_configured) {
    return "AI summaries unavailable: Configure GCP project with <code>gcloud config set project PROJECT_ID</code>.";
  }
  return "AI summaries unavailable: Check your GCloud configuration.";
}

interface WarningBannerProps {
  authStatus: AuthStatusResponse | undefined;
}

export function WarningBanner({ authStatus }: WarningBannerProps) {
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(AUTH_DISMISSED_KEY) === "true",
  );

  if (!authStatus || dismissed) return null;

  const message = getWarningMessage(authStatus);
  if (!message) return null;

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem(AUTH_DISMISSED_KEY, "true");
  };

  return (
    <div className="warning-banner">
      <svg
        className="warning-icon"
        viewBox="0 0 16 16"
        fill="currentColor"
        role="img"
        aria-label="Warning"
      >
        <path
          fillRule="evenodd"
          d="M8.22 1.754a.25.25 0 00-.44 0L1.698 13.132a.25.25 0 00.22.368h12.164a.25.25 0 00.22-.368L8.22 1.754zm-1.763-.707c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0114.082 15H1.918a1.75 1.75 0 01-1.543-2.575L6.457 1.047zM9 11a1 1 0 11-2 0 1 1 0 012 0zm-.25-5.25a.75.75 0 00-1.5 0v2.5a.75.75 0 001.5 0v-2.5z"
        />
      </svg>
      <span dangerouslySetInnerHTML={{ __html: message }} />
      <button
        type="button"
        className="warning-dismiss"
        aria-label="Dismiss warning"
        onClick={handleDismiss}
      >
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
        </svg>
      </button>
    </div>
  );
}
