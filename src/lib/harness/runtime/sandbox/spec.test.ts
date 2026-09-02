import { describe, expect, it } from "vitest";
import { assertSandboxSpec, createSandboxSpec } from "./spec";

describe("sandbox specification", () => {
  it("creates a resource-bounded, non-root, offline per-run sandbox", () => {
    const spec = createSandboxSpec({ image: "runtime@sha256:abc", command: ["agent"], runId: "run-1", workspaceRoot: "/sandboxes" });
    expect(spec).toMatchObject({ user: "65532:65532", readOnlyRootFilesystem: true, network: "none", noNewPrivileges: true, workspace: { hostPath: "/sandboxes/run-1" } });
    expect(spec.resources).toEqual({ cpuCount: 1, memoryBytes: 536870912, pids: 128, timeoutMs: 600000 });
  });

  it.each([
    ["root user", { user: "0:0" }],
    ["writable root", { readOnlyRootFilesystem: false }],
    ["network", { network: "bridge" }],
  ])("rejects privileged configuration: %s", (_label, override) => {
    const base = createSandboxSpec({ image: "runtime", command: ["agent"], runId: "run-1", workspaceRoot: "/sandboxes" });
    expect(() => assertSandboxSpec({ ...base, ...override } as typeof base, "/sandboxes")).toThrow();
  });

  it("rejects Docker socket and additional writable mounts", () => {
    const base = createSandboxSpec({ image: "runtime", command: ["agent"], runId: "run-1", workspaceRoot: "/sandboxes" });
    expect(() => assertSandboxSpec({ ...base, mounts: [...base.mounts, { source: "/var/run/docker.sock", target: "/var/run/docker.sock", readOnly: false }] }, "/sandboxes")).toThrow("Docker socket");
    expect(() => assertSandboxSpec({ ...base, mounts: [...base.mounts, { source: "/tmp", target: "/tmp", readOnly: false }] }, "/sandboxes")).toThrow("Only the per-run workspace");
  });

  it("rejects workspace traversal and invalid resource limits", () => {
    expect(() => createSandboxSpec({ image: "runtime", command: ["agent"], runId: "../escape", workspaceRoot: "/sandboxes" })).toThrow();
    expect(() => createSandboxSpec({ image: "runtime", command: ["agent"], runId: "run-1", workspaceRoot: "/sandboxes", resources: { pids: 0 } })).toThrow("positive integers");
  });
});
