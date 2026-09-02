import { describe, expect, it, vi } from "vitest";
import type { ExecutionPolicy } from "../../protocol/policy";
import { ToolExecutor, type ToolSuccessResult } from "../executor";
import type { ToolCallLedger } from "../idempotency";
import { ToolRegistry } from "../registry";
import { createReadToolDefinitions } from "./read-tools";

const ledger: ToolCallLedger<ToolSuccessResult> = {
  claim: vi.fn(async () => ({ claimed: true as const })),
  complete: vi.fn(async () => undefined),
  fail: vi.fn(async () => undefined),
};

describe("controlled read tools", () => {
  it("denies cross-room arguments before invoking the repository", async () => {
    const repository = { findRoom: vi.fn(), findArtifactInRoom: vi.fn() };
    const registry = new ToolRegistry();
    createReadToolDefinitions(repository).forEach((tool) => registry.register(tool));
    const tool = registry.resolve("room.info.read", "1.0.0");
    const policy: ExecutionPolicy = {
      version: 1, allowedTools: [tool.id], deniedTools: [], approvalTools: [], allowedHosts: [], workspaceRoots: [], toolDisclosure: "index", skillDisclosure: "catalog",
    };
    const result = await new ToolExecutor(registry, ledger, { put: vi.fn() }).execute({
      runId: "run-1", roomId: "room-1", toolCallId: "call-1", toolId: tool.id, toolVersion: tool.version,
      expectedSchemaDigest: tool.schemaDigest, arguments: { roomId: "room-2" }, policy,
      skillAllowedTools: new Set([tool.id]), agentCapabilities: new Set(["room:read"]),
      remainingToolCalls: 1, remainingWallTimeMs: 1_000,
      checkMemberPermission: () => true, checkArgumentBoundary: () => true,
    });
    expect(result).toMatchObject({ status: "DENIED", reason: "argument_boundary_violation" });
    expect(repository.findRoom).not.toHaveBeenCalled();
  });

  it("passes both room and artifact identity to the scoped repository", async () => {
    const repository = {
      findRoom: vi.fn(),
      findArtifactInRoom: vi.fn(async () => ({ id: "artifact-1", runId: "run-1", mimeType: "image/png", width: 1, height: 1, byteSize: 10, sha256: "hash", moderationStatus: null, expiresAt: null, createdAt: new Date("2026-01-01") })),
    };
    const registry = new ToolRegistry();
    createReadToolDefinitions(repository).forEach((tool) => registry.register(tool));
    const tool = registry.resolve("artifact.metadata.read", "1.0.0");
    const policy: ExecutionPolicy = { version: 1, allowedTools: [tool.id], deniedTools: [], approvalTools: [], allowedHosts: [], workspaceRoots: [], toolDisclosure: "index", skillDisclosure: "catalog" };
    const result = await new ToolExecutor(registry, ledger, { put: vi.fn() }).execute({
      runId: "run-1", roomId: "room-1", toolCallId: "call-2", toolId: tool.id, toolVersion: tool.version,
      expectedSchemaDigest: tool.schemaDigest, arguments: { roomId: "room-1", artifactId: "artifact-1" }, policy,
      skillAllowedTools: new Set([tool.id]), agentCapabilities: new Set(["artifact:read"]), remainingToolCalls: 1, remainingWallTimeMs: 1_000,
      checkMemberPermission: () => true, checkArgumentBoundary: () => true,
    });
    expect(result).toMatchObject({ status: "SUCCEEDED", result: { id: "artifact-1" } });
    expect(repository.findArtifactInRoom).toHaveBeenCalledWith("room-1", "artifact-1");
  });
});
