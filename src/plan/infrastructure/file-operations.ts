import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import type { PlanDiscoveryDeps } from "../domain/ports";

export function createPlanDiscoveryDeps(): PlanDiscoveryDeps {
  return {
    fileExists: (path) => existsSync(path),
    readFileText: (path) => {
      try {
        return readFileSync(path, "utf-8");
      } catch {
        return null;
      }
    },
    listDir: (path) => {
      try {
        return readdirSync(path);
      } catch {
        return [];
      }
    },
    getFileMtime: (path) => {
      try {
        return statSync(path).mtimeMs;
      } catch {
        return 0;
      }
    },
    homeDir: () => homedir(),
    deleteFile: (path) => {
      try {
        unlinkSync(path);
        return true;
      } catch {
        return false;
      }
    },
  };
}
