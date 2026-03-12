import type { SessionResponse, SessionsApiResponse } from "@shared/types";

/**
 * Compare two sessions for rendering-relevant field equality.
 * Excludes `last_activity` (sort-only, not displayed in UI).
 */
function isSessionEqual(a: SessionResponse, b: SessionResponse): boolean {
  return (
    a.pane_id === b.pane_id &&
    a.status === b.status &&
    a.summary === b.summary &&
    a.project_name === b.project_name &&
    a.git_branch === b.git_branch &&
    a.github_repo_url === b.github_repo_url &&
    a.tmux_target === b.tmux_target &&
    a.tmux_session_name === b.tmux_session_name &&
    a.agent_type === b.agent_type &&
    a.cwd === b.cwd
  );
}

/**
 * Check whether incoming SSE session data differs from the cached data
 * in rendering-relevant ways. Returns `true` when the cache should be
 * updated (triggering a React re-render), `false` when the update can
 * be safely skipped.
 *
 * Order-sensitive: compares sessions by array index so that server-side
 * sort-order changes (detected via `pane_id` position shifts) are caught.
 */
export function hasSessionsChanged(prev: SessionsApiResponse, next: SessionsApiResponse): boolean {
  const prevSessions = prev.sessions;
  const nextSessions = next.sessions;

  if (prevSessions.length !== nextSessions.length) return true;

  for (let i = 0; i < prevSessions.length; i++) {
    if (!isSessionEqual(prevSessions[i], nextSessions[i])) return true;
  }

  return false;
}
