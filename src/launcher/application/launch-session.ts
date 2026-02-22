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

  // Combine git checkout and agent command into a single tmuxSendKeys call.
  // Sending them separately causes the Enter key (\r) from the first command to be
  // buffered in canonical mode and translated to \n (Ctrl-J) by the terminal driver.
  // Fish shell's Ctrl-J binding (e.g. zoxide's `zi`) then intercepts the second
  // command instead of executing it.
  const defaultBranch = deps.getDefaultBranch(config.projectPath);
  if (defaultBranch) {
    deps.tmuxSendKeys(paneId, `git checkout ${defaultBranch}; ${config.agentType}`);
  } else {
    deps.tmuxSendKeys(paneId, config.agentType);
  }

  return {
    success: true,
    sessionName: config.sessionName,
    paneId,
  };
}
