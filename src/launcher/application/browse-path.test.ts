import { describe, expect, it } from "bun:test";
import { createMockLauncherDeps } from "../__tests__";
import { browsePath } from "./browse-path";

describe("browsePath", () => {
  it("returns empty entries for empty input", () => {
    const deps = createMockLauncherDeps();
    const result = browsePath("", deps);
    expect(result.entries).toEqual([]);
    expect(result.basePath).toBe("");
  });

  it("returns empty entries for input without slash", () => {
    const deps = createMockLauncherDeps();
    const result = browsePath("src", deps);
    expect(result.entries).toEqual([]);
    expect(result.basePath).toBe("");
  });

  it("lists directories when path has trailing slash", () => {
    const deps = createMockLauncherDeps({
      resolvePath: (p) => p,
      readDir: (path) => (path === "/home/test/src" ? ["project-a", "project-b", "file.txt"] : []),
      isDirectory: (path) => !path.endsWith("file.txt"),
      pathExists: () => true,
    });
    const result = browsePath("/home/test/src/", deps);
    expect(result.entries).toEqual([
      { name: "project-a", path: "/home/test/src/project-a" },
      { name: "project-b", path: "/home/test/src/project-b" },
    ]);
    expect(result.basePath).toBe("/home/test/src");
  });

  it("filters entries by prefix (case-insensitive)", () => {
    const deps = createMockLauncherDeps({
      resolvePath: (p) => p.replace(/^~/, "/home/test"),
      readDir: () => ["alpha", "Beta", "another"],
      isDirectory: () => true,
      pathExists: () => true,
    });
    const result = browsePath("~/al", deps);
    expect(result.entries).toEqual([{ name: "alpha", path: "/home/test/alpha" }]);
  });

  it("expands tilde via resolvePath", () => {
    const deps = createMockLauncherDeps({
      resolvePath: (p) => p.replace(/^~/, "/home/test"),
      readDir: () => ["src", "docs"],
      isDirectory: () => true,
      pathExists: () => true,
    });
    const result = browsePath("~/", deps);
    expect(result.entries).toHaveLength(2);
    expect(result.basePath).toBe("/home/test");
  });

  it("handles tilde alone (no trailing slash)", () => {
    const deps = createMockLauncherDeps({
      readDir: () => ["src", "docs"],
      isDirectory: () => true,
      pathExists: () => true,
    });
    const result = browsePath("~", deps);
    expect(result.entries).toHaveLength(2);
  });

  it("returns empty when path does not exist", () => {
    const deps = createMockLauncherDeps({
      resolvePath: (p) => p,
      pathExists: () => false,
    });
    const result = browsePath("/home/test/nonexistent/", deps);
    expect(result.entries).toEqual([]);
  });

  it("returns empty when path is not a directory", () => {
    const deps = createMockLauncherDeps({
      resolvePath: (p) => p,
      pathExists: () => true,
      isDirectory: (path) => !path.endsWith("file.txt"),
    });
    const result = browsePath("/home/test/file.txt/", deps);
    expect(result.entries).toEqual([]);
  });

  it("hides hidden directories (dotfiles)", () => {
    const deps = createMockLauncherDeps({
      resolvePath: (p) => p,
      readDir: () => [".git", ".cache", "src", "docs"],
      isDirectory: () => true,
      pathExists: () => true,
    });
    const result = browsePath("/home/test/", deps);
    expect(result.entries.map((e) => e.name)).toEqual(["docs", "src"]);
  });

  it("sorts entries alphabetically", () => {
    const deps = createMockLauncherDeps({
      resolvePath: (p) => p,
      readDir: () => ["zebra", "alpha", "middle"],
      isDirectory: () => true,
      pathExists: () => true,
    });
    const result = browsePath("/home/test/projects/", deps);
    expect(result.entries.map((e) => e.name)).toEqual(["alpha", "middle", "zebra"]);
  });

  it("returns empty entries for paths outside home directory", () => {
    const deps = createMockLauncherDeps({
      resolvePath: (p) => p,
      readDir: () => ["usr", "home", "etc"],
      isDirectory: () => true,
      pathExists: () => true,
    });
    const result = browsePath("/", deps);
    expect(result.entries).toEqual([]);
    expect(result.basePath).toBe("/");
  });

  it("handles tilde with partial name filter", () => {
    const deps = createMockLauncherDeps({
      readDir: () => ["src", "snap", "Documents"],
      isDirectory: () => true,
      pathExists: () => true,
    });
    const result = browsePath("~/s", deps);
    expect(result.entries.map((e) => e.name)).toEqual(["snap", "src"]);
  });

  it("handles nested path with partial filter", () => {
    const deps = createMockLauncherDeps({
      resolvePath: (p) => p.replace(/^~/, "/home/test"),
      readDir: () => ["panopticon", "personal", "docs"],
      isDirectory: () => true,
      pathExists: () => true,
    });
    const result = browsePath("~/src/pa", deps);
    expect(result.entries).toEqual([{ name: "panopticon", path: "/home/test/src/panopticon" }]);
    expect(result.basePath).toBe("/home/test/src");
  });

  it("returns empty entries for absolute paths outside home directory", () => {
    const deps = createMockLauncherDeps({
      resolvePath: (p) => p,
      readDir: () => ["secret", "data"],
      isDirectory: () => true,
      pathExists: () => true,
    });
    const result = browsePath("/etc/", deps);
    expect(result.entries).toEqual([]);
    expect(result.basePath).toBe("/etc");
  });

  it("allows browsing paths inside home directory", () => {
    const deps = createMockLauncherDeps({
      resolvePath: (p) => p.replace(/^~/, "/home/test"),
      readDir: () => ["project-a", "project-b"],
      isDirectory: () => true,
      pathExists: () => true,
    });
    const result = browsePath("~/src/", deps);
    expect(result.entries).toHaveLength(2);
  });

  it("rejects path that is a prefix of home but not a descendant", () => {
    const deps = createMockLauncherDeps({
      resolvePath: (p) => p,
      readDir: () => ["data"],
      isDirectory: () => true,
      pathExists: () => true,
    });
    const result = browsePath("/home/testevil/", deps);
    expect(result.entries).toEqual([]);
  });
});
