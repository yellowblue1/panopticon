import { describe, expect, it } from "bun:test";
import { dialectsForAgent, mergeUniqueCommands, triggerKeysForAgent } from "./agent-dialect";

describe("dialectsForAgent", () => {
  it("maps claude to the claude dialect only", () => {
    expect(dialectsForAgent("claude")).toEqual(["claude"]);
  });

  it("maps codex to the codex dialect only", () => {
    expect(dialectsForAgent("codex")).toEqual(["codex"]);
  });

  it("maps nori to both dialects so wrapped backends are covered", () => {
    expect(dialectsForAgent("nori")).toEqual(["claude", "codex"]);
  });
});

describe("triggerKeysForAgent", () => {
  it("uses / for claude", () => {
    expect(triggerKeysForAgent("claude")).toEqual(["/"]);
  });

  it("uses $ for codex", () => {
    expect(triggerKeysForAgent("codex")).toEqual(["$"]);
  });

  it("uses both / and $ for nori, in dialect order", () => {
    expect(triggerKeysForAgent("nori")).toEqual(["/", "$"]);
  });
});

describe("mergeUniqueCommands", () => {
  it("returns an empty list when nothing is passed", () => {
    expect(mergeUniqueCommands()).toEqual([]);
  });

  it("returns a single list as-is", () => {
    const list = [
      { command: "/foo", description: "Foo" },
      { command: "/bar", description: "Bar" },
    ];
    expect(mergeUniqueCommands(list)).toEqual(list);
  });

  it("concatenates disjoint lists in order", () => {
    const claude = [{ command: "/foo", description: "Foo" }];
    const codex = [{ command: "$bar", description: "Bar" }];
    expect(mergeUniqueCommands(claude, codex)).toEqual([
      { command: "/foo", description: "Foo" },
      { command: "$bar", description: "Bar" },
    ]);
  });

  it("keeps the first occurrence when the same command appears twice", () => {
    const first = [{ command: "/foo", description: "First" }];
    const second = [{ command: "/foo", description: "Second" }];
    expect(mergeUniqueCommands(first, second)).toEqual([{ command: "/foo", description: "First" }]);
  });

  it("does not collapse same-named commands under different prefixes", () => {
    // `/brainstorming` and `$brainstorming` are distinct commands — the user
    // chooses which dialect to invoke via the prefix.
    const claude = [{ command: "/brainstorming", description: "Claude" }];
    const codex = [{ command: "$brainstorming", description: "Codex" }];
    expect(mergeUniqueCommands(claude, codex)).toEqual([
      { command: "/brainstorming", description: "Claude" },
      { command: "$brainstorming", description: "Codex" },
    ]);
  });
});
