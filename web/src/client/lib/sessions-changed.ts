import type { SessionResponse, SessionsApiResponse } from "@shared/types";

/**
 * Keys intentionally excluded from the equality check.
 *
 * `last_activity` — updated every few seconds by the polling loop. Treating it
 * as rendering-relevant would cause near-continuous re-renders that reset the
 * scroll position. Server-side sort-order changes driven by `last_activity`
 * are still detected because the comparison is index-based: when the server
 * reorders sessions, `pane_id` at a given index changes and triggers an update.
 */
type IgnoredSessionKey = "last_activity";

/** Compile-time guard: every `SessionResponse` field must be either compared or explicitly ignored. */
const _comparedKeys: Record<Exclude<keyof SessionResponse, IgnoredSessionKey>, true> = {
  pane_id: true,
  status: true,
  summary: true,
  project_name: true,
  window_name: true,
  github_repo_url: true,
  tmux_target: true,
  tmux_session_name: true,
  agent_type: true,
  cwd: true,
};

/**
 * Compare two sessions for rendering-relevant field equality.
 */
function isSessionEqual(a: SessionResponse, b: SessionResponse): boolean {
  return (
    a.pane_id === b.pane_id &&
    a.status === b.status &&
    a.summary === b.summary &&
    a.project_name === b.project_name &&
    a.window_name === b.window_name &&
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
