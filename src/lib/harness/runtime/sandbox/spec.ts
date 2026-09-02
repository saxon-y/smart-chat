import { resolve } from "node:path";
import type { SandboxSpec, SandboxSpecInput } from "./types";

const DEFAULT_RESOURCES: SandboxSpec["resources"] = {
  cpuCount: 1,
  memoryBytes: 512 * 1024 * 1024,
  pids: 128,
  timeoutMs: 10 * 60 * 1_000,
};

const runIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function createSandboxSpec(input: SandboxSpecInput): SandboxSpec {
  if (!input.image.trim() || input.image.includes("\0")) throw new Error("Sandbox image is required");
  if (!input.command.length || input.command.some((part) => !part || part.includes("\0"))) throw new Error("Sandbox command is invalid");
  if (!runIdPattern.test(input.runId)) throw new Error("Sandbox run id is invalid");
  const workspaceRoot = resolve(input.workspaceRoot);
  const hostPath = resolve(workspaceRoot, input.runId);
  const spec: SandboxSpec = {
    image: input.image,
    command: [...input.command],
    user: "65532:65532",
    readOnlyRootFilesystem: true,
    network: "none",
    noNewPrivileges: true,
    dropCapabilities: ["ALL"],
    resources: { ...DEFAULT_RESOURCES, ...input.resources },
    workspace: { hostPath, containerPath: "/workspace", runId: input.runId },
    mounts: [{ source: hostPath, target: "/workspace", readOnly: false }],
  };
  assertSandboxSpec(spec, workspaceRoot);
  return spec;
}

export function assertSandboxSpec(spec: SandboxSpec, workspaceRoot: string): void {
  if (spec.user === "root" || spec.user === "0" || spec.user.startsWith("0:")) throw new Error("Sandbox must run as non-root");
  if (!spec.readOnlyRootFilesystem) throw new Error("Sandbox root filesystem must be read-only");
  if (spec.network !== "none") throw new Error("Sandbox network must be disabled by default");
  if (!spec.noNewPrivileges || !spec.dropCapabilities.includes("ALL")) throw new Error("Sandbox process privileges are not restricted");
  const values = Object.values(spec.resources);
  if (values.some((value) => !Number.isSafeInteger(value) || value <= 0)) throw new Error("Sandbox resource limits must be positive integers");
  const root = resolve(workspaceRoot);
  const workspace = resolve(spec.workspace.hostPath);
  if (workspace === root || !workspace.startsWith(`${root}/`)) throw new Error("Sandbox workspace must be isolated per run");
  if (spec.workspace.containerPath !== "/workspace") throw new Error("Sandbox workspace target is invalid");
  for (const mount of spec.mounts) {
    const target = resolve("/", mount.target);
    if (target === "/var/run/docker.sock" || resolve(mount.source) === "/var/run/docker.sock") throw new Error("Docker socket mounts are forbidden");
    if (!mount.readOnly && (target === "/" || target !== "/workspace" || resolve(mount.source) !== workspace)) {
      throw new Error("Only the per-run workspace may be writable");
    }
  }
}
