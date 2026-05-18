import { describe, expect, it } from "bun:test";
import { isValidPaneAction } from "./ports";

describe("isValidPaneAction", () => {
  it("accepts a well-formed yesno action", () => {
    expect(isValidPaneAction({ type: "yesno" })).toBe(true);
  });

  it("accepts a well-formed none action", () => {
    expect(isValidPaneAction({ type: "none" })).toBe(true);
  });

  it("accepts a well-formed freeform action", () => {
    expect(isValidPaneAction({ type: "freeform", placeholder: "Enter path..." })).toBe(true);
  });

  it("rejects a freeform action missing placeholder", () => {
    expect(isValidPaneAction({ type: "freeform" })).toBe(false);
  });

  it("rejects a freeform action with non-string placeholder", () => {
    expect(isValidPaneAction({ type: "freeform", placeholder: 42 })).toBe(false);
  });

  it("accepts a well-formed choices action", () => {
    expect(
      isValidPaneAction({
        type: "choices",
        options: [
          { label: "1. A", value: "1", autoEnter: true },
          { label: "2. B", value: "2", autoEnter: false },
        ],
      }),
    ).toBe(true);
  });

  it("accepts a choices action with an empty options array", () => {
    expect(isValidPaneAction({ type: "choices", options: [] })).toBe(true);
  });

  it("rejects a choices action where options is not an array", () => {
    expect(isValidPaneAction({ type: "choices", options: "not-an-array" })).toBe(false);
  });

  it("rejects a choices action with a malformed option entry", () => {
    expect(
      isValidPaneAction({
        type: "choices",
        options: [{ label: "1. A", value: "1" }],
      }),
    ).toBe(false);
  });

  it("rejects an unknown action type", () => {
    expect(isValidPaneAction({ type: "execute", command: "rm -rf /" })).toBe(false);
  });

  it("rejects non-object inputs", () => {
    expect(isValidPaneAction(null)).toBe(false);
    expect(isValidPaneAction("yesno")).toBe(false);
    expect(isValidPaneAction(42)).toBe(false);
  });
});
