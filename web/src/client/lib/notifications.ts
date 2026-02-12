import type { SessionResponse } from "@shared/types";

const shownPaneIds = new Set<string>();

export function requestNotificationPermission(): void {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

export function showBrowserNotification(session: SessionResponse): void {
  if (!("Notification" in window)) return;
  if (session.status !== "waiting") return;
  if (shownPaneIds.has(session.pane_id)) return;
  shownPaneIds.add(session.pane_id);
  if (Notification.permission !== "granted") return;

  const title = `[Waiting] ${session.project_name}`;
  const body = session.summary || "Agent is waiting for input";

  new Notification(title, {
    body,
    tag: `panopticon-${session.pane_id}`,
    icon: "/favicon.ico",
  });
}

export function clearNotificationTracking(paneId: string): void {
  shownPaneIds.delete(paneId);
}
