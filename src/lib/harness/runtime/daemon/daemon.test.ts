import { mkdtemp, readFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { LocalArtifactStorage } from "@/lib/ai/artifact-storage";
import { DaemonClient } from "./client";
import { issueTaskCredential, verifyTaskCredential } from "./credential";
import type { DaemonControlPlaneTransport, WakeConnector } from "./types";
import { WorkspaceManager } from "./workspace";

const secret = "a-secure-daemon-control-plane-secret";

describe("task credentials", () => {
  it("binds a short-lived credential to run, daemon, and capabilities", () => {
    const token = issueTaskCredential({ runId: "run-1", daemonId: "daemon-1", capabilities: ["text"] }, secret, { now: 1_000, ttlMs: 1_000 });
    expect(verifyTaskCredential(token, secret, { runId: "run-1", daemonId: "daemon-1", capabilities: ["text"] }, 1_500).runId).toBe("run-1");
    expect(() => verifyTaskCredential(token, secret, { runId: "run-1", daemonId: "daemon-1", capabilities: ["code"] }, 1_500)).toThrow("credential_capability_mismatch");
    expect(() => verifyTaskCredential(token, secret, { runId: "run-1", daemonId: "daemon-1", capabilities: ["text"] }, 2_000)).toThrow("credential_expired");
  });
});

describe("DaemonClient", () => {
  it("rejects unhealthy and capability-mismatched claims", async () => {
    let now = 1_000;
    const transport: DaemonControlPlaneTransport = {
      register: vi.fn().mockResolvedValue({ daemonId: "d1", version: "1", capabilities: ["text"], registeredAt: now, lastHeartbeatAt: now, expiresAt: 2_000 }),
      heartbeat: vi.fn(),
      claim: vi.fn().mockResolvedValue({ runId: "r1", requiredCapabilities: ["code"], credential: "unused" }),
    };
    const client = new DaemonClient({ daemonId: "d1", version: "1", capabilities: ["text"] }, transport, secret, { now: () => now, heartbeatTimeoutMs: 500 });
    expect(await client.claim()).toBeNull();
    await client.register();
    expect(await client.claim()).toBeNull();
    now = 1_501;
    expect(await client.claim()).toBeNull();
    expect(transport.claim).toHaveBeenCalledTimes(1);
  });

  it("falls back to polling when wake connection cannot be established", async () => {
    const token = issueTaskCredential({ runId: "r1", daemonId: "d1", capabilities: ["text"] }, secret);
    const transport: DaemonControlPlaneTransport = {
      register: vi.fn().mockImplementation(async (registration) => ({ ...registration, registeredAt: Date.now(), lastHeartbeatAt: Date.now(), expiresAt: Date.now() + 60_000 })),
      heartbeat: vi.fn(),
      claim: vi.fn().mockResolvedValueOnce({ runId: "r1", requiredCapabilities: ["text"], credential: token }).mockResolvedValue(null),
    };
    const connector: WakeConnector = { connect: vi.fn().mockRejectedValue(new Error("offline")) };
    const client = new DaemonClient({ daemonId: "d1", version: "1", capabilities: ["text"] }, transport, secret);
    await client.register();
    const controller = new AbortController();
    const iterator = client.watch(connector, { pollIntervalMs: 1, signal: controller.signal });
    const first = await iterator.next();
    controller.abort();
    await iterator.return(undefined);
    expect(first.value.runId).toBe("r1");
  });
});

describe("WorkspaceManager", () => {
  it("enforces size, allowed paths, traversal, and symlink boundaries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workspace-test-"));
    const manager = new WorkspaceManager(root);
    const workspace = await manager.create("run-1", { mode: "ephemeral", allowedPaths: ["output"], maxBytes: 5 });
    await manager.write(workspace, "output/a.txt", "12345");
    await expect(manager.write(workspace, "output/b.txt", "1")).rejects.toThrow("workspace_size_exceeded");
    await expect(manager.write(workspace, "private.txt", "x")).rejects.toThrow("workspace_path_not_allowed");
    await expect(manager.write(workspace, "../outside", "x")).rejects.toThrow("workspace_path_invalid");
    await symlink(root, path.join(workspace.root, "output", "link"));
    await expect(manager.write(workspace, "output/link/escape", "x")).rejects.toThrow("workspace_symlink_forbidden");
  });

  it("updates managed context, uploads artifacts, and applies cleanup policy", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workspace-test-"));
    const manager = new WorkspaceManager(root);
    const workspace = await manager.create("run-2", { mode: "ephemeral", preserveOnFailure: true, maxBytes: 1_000 });
    await manager.write(workspace, "AGENTS.md", "user content\n");
    await manager.injectContext(workspace, "AGENTS.md", "first");
    await manager.injectContext(workspace, "AGENTS.md", "second");
    const content = await readFile(path.join(workspace.root, "AGENTS.md"), "utf8");
    expect(content).toContain("user content\n");
    expect(content).not.toContain("first");
    expect(content.match(/SMART_CHAT_CONTEXT:BEGIN/g)).toHaveLength(1);
    const storage = new LocalArtifactStorage(await mkdtemp(path.join(os.tmpdir(), "artifact-test-")));
    expect((await manager.uploadArtifact(workspace, "AGENTS.md", "runs/run-2/AGENTS.md", storage)).byteSize).toBeGreaterThan(0);
    expect(await manager.cleanup(workspace, "failure")).toEqual({ preserved: true });

    const disposable = await manager.create("run-3", { mode: "ephemeral", maxBytes: 10 });
    expect(await manager.cleanup(disposable, "success")).toEqual({ preserved: false });
    await expect(readFile(disposable.root)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
