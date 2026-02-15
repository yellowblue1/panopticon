import { describe, expect, it } from "bun:test";
import {
  type AppNotification,
  addNotification,
  clearAll,
  createNotification,
  describeNotification,
  dismissExpired,
  EMPTY_STORE,
  formatRelativeTime,
  isDuplicate,
  markAllAsRead,
  markAsRead,
  type NotificationStore,
  unreadCount,
} from "./notification-store";

function makeNotification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: crypto.randomUUID(),
    trigger: "session_waiting",
    paneId: "pane-1",
    projectName: "test-project",
    summary: null,
    timestamp: Date.now(),
    read: false,
    ...overrides,
  };
}

describe("createNotification", () => {
  it("creates a notification with unique id and current timestamp", () => {
    const n = createNotification({ paneId: "p1", projectName: "proj", summary: "hello" });
    expect(n.id).toBeTruthy();
    expect(n.trigger).toBe("session_waiting");
    expect(n.paneId).toBe("p1");
    expect(n.projectName).toBe("proj");
    expect(n.summary).toBe("hello");
    expect(n.read).toBe(false);
    expect(typeof n.timestamp).toBe("number");
  });

  it("generates different ids for each call", () => {
    const a = createNotification({ paneId: "p1", projectName: "proj", summary: null });
    const b = createNotification({ paneId: "p1", projectName: "proj", summary: null });
    expect(a.id).not.toBe(b.id);
  });
});

describe("addNotification", () => {
  it("prepends notification to the list", () => {
    const first = makeNotification({ id: "first" });
    const second = makeNotification({ id: "second" });
    let store = addNotification(EMPTY_STORE, first);
    store = addNotification(store, second);
    expect(store.notifications[0].id).toBe("second");
    expect(store.notifications[1].id).toBe("first");
  });

  it("caps at 50 notifications", () => {
    let store: NotificationStore = EMPTY_STORE;
    for (let i = 0; i < 55; i++) {
      store = addNotification(store, makeNotification({ id: `n-${i}` }));
    }
    expect(store.notifications.length).toBe(50);
    expect(store.notifications[0].id).toBe("n-54");
  });
});

describe("isDuplicate", () => {
  it("returns true when unread notification exists for same pane and trigger", () => {
    const store = addNotification(EMPTY_STORE, makeNotification({ paneId: "p1", read: false }));
    expect(isDuplicate(store, "p1", "session_waiting")).toBe(true);
  });

  it("returns false when notification for same pane is already read", () => {
    const store = addNotification(EMPTY_STORE, makeNotification({ paneId: "p1", read: true }));
    expect(isDuplicate(store, "p1", "session_waiting")).toBe(false);
  });

  it("returns false when no notification exists for the pane", () => {
    const store = addNotification(EMPTY_STORE, makeNotification({ paneId: "p1" }));
    expect(isDuplicate(store, "p2", "session_waiting")).toBe(false);
  });

  it("returns false for empty store", () => {
    expect(isDuplicate(EMPTY_STORE, "p1", "session_waiting")).toBe(false);
  });
});

describe("markAsRead", () => {
  it("sets read to true for the given notification id", () => {
    const n = makeNotification({ id: "target", read: false });
    const store = addNotification(EMPTY_STORE, n);
    const updated = markAsRead(store, "target");
    expect(updated.notifications[0].read).toBe(true);
  });

  it("returns unchanged store when id not found", () => {
    const store = addNotification(EMPTY_STORE, makeNotification());
    const updated = markAsRead(store, "nonexistent");
    expect(updated).toBe(store);
  });

  it("does not affect other notifications", () => {
    const a = makeNotification({ id: "a", read: false });
    const b = makeNotification({ id: "b", read: false });
    let store = addNotification(EMPTY_STORE, a);
    store = addNotification(store, b);
    const updated = markAsRead(store, "a");
    expect(updated.notifications.find((n) => n.id === "a")?.read).toBe(true);
    expect(updated.notifications.find((n) => n.id === "b")?.read).toBe(false);
  });
});

describe("markAllAsRead", () => {
  it("marks all notifications as read", () => {
    let store = addNotification(EMPTY_STORE, makeNotification({ read: false }));
    store = addNotification(store, makeNotification({ read: false }));
    const updated = markAllAsRead(store);
    expect(updated.notifications.every((n) => n.read)).toBe(true);
  });

  it("returns same reference when all already read", () => {
    const store = addNotification(EMPTY_STORE, makeNotification({ read: true }));
    const updated = markAllAsRead(store);
    expect(updated).toBe(store);
  });

  it("handles empty store", () => {
    const updated = markAllAsRead(EMPTY_STORE);
    expect(updated).toBe(EMPTY_STORE);
  });
});

describe("dismissExpired", () => {
  it("removes notifications older than maxAgeMs", () => {
    const old = makeNotification({ timestamp: Date.now() - 7200_000 });
    const recent = makeNotification({ timestamp: Date.now() - 1000 });
    let store = addNotification(EMPTY_STORE, old);
    store = addNotification(store, recent);
    const updated = dismissExpired(store, 3600_000);
    expect(updated.notifications.length).toBe(1);
    expect(updated.notifications[0].id).toBe(recent.id);
  });

  it("keeps notifications within the age limit", () => {
    const recent = makeNotification({ timestamp: Date.now() - 1000 });
    const store = addNotification(EMPTY_STORE, recent);
    const updated = dismissExpired(store, 3600_000);
    expect(updated.notifications.length).toBe(1);
  });

  it("returns same reference when nothing expired", () => {
    const recent = makeNotification({ timestamp: Date.now() });
    const store = addNotification(EMPTY_STORE, recent);
    const updated = dismissExpired(store, 3600_000);
    expect(updated).toBe(store);
  });
});

describe("unreadCount", () => {
  it("returns count of unread notifications", () => {
    let store = addNotification(EMPTY_STORE, makeNotification({ read: false }));
    store = addNotification(store, makeNotification({ read: true }));
    store = addNotification(store, makeNotification({ read: false }));
    expect(unreadCount(store)).toBe(2);
  });

  it("returns 0 for empty store", () => {
    expect(unreadCount(EMPTY_STORE)).toBe(0);
  });
});

describe("clearAll", () => {
  it("returns empty store", () => {
    const result = clearAll();
    expect(result.notifications.length).toBe(0);
  });
});

describe("describeNotification", () => {
  it("returns summary when present", () => {
    const n = makeNotification({ summary: "Agent needs approval" });
    expect(describeNotification(n)).toBe("Agent needs approval");
  });

  it("returns default message when summary is null", () => {
    const n = makeNotification({ summary: null });
    expect(describeNotification(n)).toBe("Waiting for input");
  });
});

describe("formatRelativeTime", () => {
  it("returns 'just now' for recent timestamps", () => {
    expect(formatRelativeTime(Date.now() - 5000)).toBe("just now");
  });

  it("returns minutes ago for timestamps within an hour", () => {
    expect(formatRelativeTime(Date.now() - 5 * 60 * 1000)).toBe("5m ago");
  });

  it("returns hours ago for older timestamps", () => {
    expect(formatRelativeTime(Date.now() - 2 * 60 * 60 * 1000)).toBe("2h ago");
  });
});
