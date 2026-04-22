import { describe, expect, test } from "bun:test";
import {
  MAX_PUSH_HISTORY_ENTRIES,
  type PushHistoryEntry,
  prependCapped,
} from "./push-history-context";

function makeUrlEntry(id: string, timestamp: number): PushHistoryEntry {
  return {
    kind: "url",
    id,
    timestamp,
    sessionId: "%0",
    url: `https://example.com/${id}`,
    label: null,
  };
}

describe("prependCapped", () => {
  test("prepends a new entry so the list is newest-first", () => {
    const a = makeUrlEntry("a", 1);
    const b = makeUrlEntry("b", 2);
    const result = prependCapped([a], b);
    expect(result).toEqual([b, a]);
  });

  test("caps total entries at MAX_PUSH_HISTORY_ENTRIES, dropping oldest", () => {
    const existing: PushHistoryEntry[] = [];
    for (let i = 0; i < MAX_PUSH_HISTORY_ENTRIES; i++) {
      existing.push(makeUrlEntry(`e${i}`, i));
    }
    const incoming = makeUrlEntry("new", MAX_PUSH_HISTORY_ENTRIES);
    const result = prependCapped(existing, incoming);
    expect(result.length).toBe(MAX_PUSH_HISTORY_ENTRIES);
    expect(result[0]).toBe(incoming);
    expect(result[result.length - 1]?.id).toBe(`e${MAX_PUSH_HISTORY_ENTRIES - 2}`);
  });
});
