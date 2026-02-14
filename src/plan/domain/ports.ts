export interface PlanDiscoveryDeps {
  fileExists: (path: string) => boolean;
  readFileText: (path: string) => string | null;
  listDir: (path: string) => string[];
  getFileMtime: (path: string) => number;
  homeDir: () => string;
  deleteFile: (path: string) => boolean;
}
