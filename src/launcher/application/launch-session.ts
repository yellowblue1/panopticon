import type { AgentType } from "../../shared/types";
import type { LauncherDeps } from "../domain/ports";
import type { LaunchConfig, LaunchResult } from "../domain/types";

export function generateSessionName(projectPath: string, agentType: AgentType): string {
  const dirName = projectPath.split("/").pop() || "session";
  const sanitized = dirName.replace(/[.\s]/g, "-").replace(/[^a-zA-Z0-9_-]/g, "");
  const name = sanitized || "session";
  return `${name}-${agentType}`;
}

export function launchSession(config: LaunchConfig, deps: LauncherDeps): LaunchResult {
  const existingSessions = deps.tmuxListSessionNames();
  const sessionExists = existingSessions.includes(config.sessionName);

  const paneId = sessionExists
    ? deps.tmuxNewWindow(config.sessionName, config.projectPath)
    : deps.tmuxNewSession(config.sessionName, config.projectPath);

  if (!paneId) {
    return {
      success: false,
      sessionName: config.sessionName,
      paneId: null,
      error: sessionExists ? "Failed to create tmux window" : "Failed to create tmux session",
    };
  }

  // Use --session-id with a fresh UUID to skip the project picker and start
  // a new session in the current directory
  const agentCommand =
    config.agentType === "claude"
      ? `claude --session-id ${crypto.randomUUID()}`
      : config.agentType;

  // Combine git checkout and agent command into a single send to avoid
  // timing issues where the second paste arrives before the first completes
  const defaultBranch = deps.getDefaultBranch(config.projectPath);
  if (defaultBranch) {
    deps.tmuxSendKeys(paneId, `git checkout ${defaultBranch} && ${agentCommand}`);
  } else {
    deps.tmuxSendKeys(paneId, agentCommand);
  }

  return {
    success: true,
    sessionName: config.sessionName,
    paneId,
  };
}
