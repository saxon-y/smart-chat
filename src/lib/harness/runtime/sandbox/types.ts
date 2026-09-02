export type SandboxMount = {
  source: string;
  target: string;
  readOnly: boolean;
};

export type SandboxSpec = {
  image: string;
  command: readonly string[];
  user: string;
  readOnlyRootFilesystem: true;
  network: "none";
  noNewPrivileges: true;
  dropCapabilities: readonly string[];
  resources: {
    cpuCount: number;
    memoryBytes: number;
    pids: number;
    timeoutMs: number;
  };
  workspace: { hostPath: string; containerPath: "/workspace"; runId: string };
  mounts: readonly SandboxMount[];
};

export type SandboxSpecInput = {
  image: string;
  command: readonly string[];
  runId: string;
  workspaceRoot: string;
  resources?: Partial<SandboxSpec["resources"]>;
};
