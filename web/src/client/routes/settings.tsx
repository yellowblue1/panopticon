import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <>
      <title>Settings - Claude Monitoring</title>
      <div className="mb-4">
        <Link to="/" className="text-accent-blue hover:underline text-sm">
          &larr; Back to sessions
        </Link>
      </div>
      <div className="empty-state">
        <p>Settings</p>
        <p className="hint">Configuration options coming soon.</p>
      </div>
    </>
  );
}
