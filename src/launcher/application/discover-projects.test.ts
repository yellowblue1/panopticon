import { describe, expect, it } from "bun:test";
import { createMockLauncherDeps } from "../__tests__";
import { discoverProjects } from "./discover-projects";

describe("discoverProjects", () => {
  it("returns empty array when no scan paths configured", () => {
    const deps = createMockLauncherDeps();
    expect(discoverProjects(deps)).toEqual([]);
  });

  it("scans configured paths and returns subdirectories as projects", () => {
    const deps = createMockLauncherDeps({
      readConfig: () => ({ scanPaths: ["/home/test/src"], useGhq: false }),
      readDir: (path) => (path === "/home/test/src" ? ["project-a", "project-b"] : []),
      isDirectory: () => true,
      getGitBranch: () => "main",
      getGitRemoteUrl: () => "https://github.com/user/repo",
    });

    const projects = discoverProjects(deps);

    expect(projects).toHaveLength(2);
    expect(projects[0]).toEqual({
      name: "project-a",
      path: "/home/test/src/project-a",
      gitBranch: "main",
      gitRemoteUrl: "https://github.com/user/repo",
    });
    expect(projects[1]).toEqual({
      name: "project-b",
      path: "/home/test/src/project-b",
      gitBranch: "main",
      gitRemoteUrl: "https://github.com/user/repo",
    });
  });

  it("skips non-directory entries", () => {
    const deps = createMockLauncherDeps({
      readConfig: () => ({ scanPaths: ["/home/test/src"], useGhq: false }),
      readDir: () => ["project", "README.md"],
      isDirectory: (path) => !path.endsWith("README.md"),
    });

    const projects = discoverProjects(deps);
    expect(projects).toHaveLength(1);
    expect(projects[0]?.name).toBe("project");
  });

  it("skips scan paths that do not exist", () => {
    const deps = createMockLauncherDeps({
      readConfig: () => ({
        scanPaths: ["/nonexistent", "/home/test/src"],
        useGhq: false,
      }),
      pathExists: (path) => path === "/home/test/src",
      readDir: (path) => (path === "/home/test/src" ? ["my-project"] : []),
    });

    const projects = discoverProjects(deps);
    expect(projects).toHaveLength(1);
    expect(projects[0]?.name).toBe("my-project");
  });

  it("skips scan paths that are not directories", () => {
    const deps = createMockLauncherDeps({
      readConfig: () => ({ scanPaths: ["/home/test/file.txt"], useGhq: false }),
      pathExists: () => true,
      isDirectory: (path) => path !== "/home/test/file.txt",
    });

    const projects = discoverProjects(deps);
    expect(projects).toEqual([]);
  });

  it("resolves tilde in scan paths", () => {
    const resolvedPaths: string[] = [];
    const deps = createMockLauncherDeps({
      readConfig: () => ({ scanPaths: ["~/src"], useGhq: false }),
      resolvePath: (p) => {
        const resolved = p.replace("~", "/home/test");
        resolvedPaths.push(resolved);
        return resolved;
      },
      readDir: () => ["project"],
    });

    discoverProjects(deps);
    expect(resolvedPaths).toContain("/home/test/src");
  });

  it("includes ghq projects when useGhq is true", () => {
    const deps = createMockLauncherDeps({
      readConfig: () => ({ scanPaths: [], useGhq: true }),
      ghqRoot: () => "/home/test/ghq",
      ghqList: () => ["github.com/user/repo-a", "github.com/user/repo-b"],
      getProjectName: (cwd) => cwd.split("/").pop() ?? "unknown",
    });

    const projects = discoverProjects(deps);
    expect(projects).toHaveLength(2);
    expect(projects[0]).toEqual({
      name: "repo-a",
      path: "/home/test/ghq/github.com/user/repo-a",
      gitBranch: null,
      gitRemoteUrl: null,
    });
  });

  it("skips ghq when useGhq is false", () => {
    const deps = createMockLauncherDeps({
      readConfig: () => ({ scanPaths: [], useGhq: false }),
      ghqRoot: () => "/home/test/ghq",
      ghqList: () => ["github.com/user/repo"],
    });

    const projects = discoverProjects(deps);
    expect(projects).toEqual([]);
  });

  it("handles ghq not installed gracefully (ghqRoot returns null)", () => {
    const deps = createMockLauncherDeps({
      readConfig: () => ({ scanPaths: [], useGhq: true }),
      ghqRoot: () => null,
      ghqList: () => [],
    });

    const projects = discoverProjects(deps);
    expect(projects).toEqual([]);
  });

  it("deduplicates projects from scan paths and ghq", () => {
    const deps = createMockLauncherDeps({
      readConfig: () => ({
        scanPaths: ["/home/test/src"],
        useGhq: true,
      }),
      readDir: (path) => (path === "/home/test/src" ? ["my-repo"] : []),
      ghqRoot: () => "/home/test/src",
      ghqList: () => ["my-repo"],
      getProjectName: (cwd) => cwd.split("/").pop() ?? "unknown",
    });

    const projects = discoverProjects(deps);
    expect(projects).toHaveLength(1);
    expect(projects[0]?.path).toBe("/home/test/src/my-repo");
  });

  it("deduplicates across multiple scan paths", () => {
    const deps = createMockLauncherDeps({
      readConfig: () => ({
        scanPaths: ["/home/test/src", "/home/test/src"],
        useGhq: false,
      }),
      readDir: () => ["project"],
    });

    const projects = discoverProjects(deps);
    expect(projects).toHaveLength(1);
  });

  it("returns projects sorted by name", () => {
    const deps = createMockLauncherDeps({
      readConfig: () => ({ scanPaths: ["/home/test/src"], useGhq: false }),
      readDir: () => ["zebra", "alpha", "middle"],
    });

    const projects = discoverProjects(deps);
    expect(projects.map((p) => p.name)).toEqual(["alpha", "middle", "zebra"]);
  });

  it("excludes git worktrees from scan path results", () => {
    const deps = createMockLauncherDeps({
      readConfig: () => ({ scanPaths: ["/home/test/src"], useGhq: false }),
      readDir: () => ["real-project", "real-project-worktrees"],
      isGitWorktree: (path) => path.endsWith("-worktrees"),
    });

    const projects = discoverProjects(deps);
    expect(projects).toHaveLength(1);
    expect(projects[0]?.name).toBe("real-project");
  });

  it("excludes git worktrees from ghq results", () => {
    const deps = createMockLauncherDeps({
      readConfig: () => ({ scanPaths: [], useGhq: true }),
      ghqRoot: () => "/home/test/ghq",
      ghqList: () => ["github.com/user/repo", "github.com/user/repo-worktrees"],
      isGitWorktree: (path) => path.endsWith("-worktrees"),
      getProjectName: (cwd) => cwd.split("/").pop() ?? "unknown",
    });

    const projects = discoverProjects(deps);
    expect(projects).toHaveLength(1);
    expect(projects[0]?.name).toBe("repo");
  });

  it("includes non-worktree projects normally when worktree filter is active", () => {
    const deps = createMockLauncherDeps({
      readConfig: () => ({ scanPaths: ["/home/test/src"], useGhq: true }),
      readDir: (path) => (path === "/home/test/src" ? ["alpha", "beta"] : []),
      ghqRoot: () => "/home/test/ghq",
      ghqList: () => ["github.com/user/gamma"],
      isGitWorktree: () => false,
      getProjectName: (cwd) => cwd.split("/").pop() ?? "unknown",
    });

    const projects = discoverProjects(deps);
    expect(projects).toHaveLength(3);
    expect(projects.map((p) => p.name)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("combines scan paths and ghq results, both sorted", () => {
    const deps = createMockLauncherDeps({
      readConfig: () => ({
        scanPaths: ["/home/test/src"],
        useGhq: true,
      }),
      readDir: (path) => (path === "/home/test/src" ? ["charlie"] : []),
      ghqRoot: () => "/home/test/ghq",
      ghqList: () => ["github.com/user/alpha"],
      getProjectName: (cwd) => cwd.split("/").pop() ?? "unknown",
    });

    const projects = discoverProjects(deps);
    expect(projects.map((p) => p.name)).toEqual(["alpha", "charlie"]);
  });
});
