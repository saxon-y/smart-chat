import { describe, expect, it, vi } from "vitest";
import { LeaseLostError, ResumeDigestMismatchError } from "./errors";
import { RuntimeRepository } from "./runtime-repository";

function setup() {
  const tx = {
    aiRun: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    agentRunEvent: {
      findFirst: vi.fn().mockResolvedValue({ sequence: 4 }),
      create: vi.fn().mockResolvedValue({ id: "event-5" }),
    },
    agentRunTurn: { create: vi.fn().mockResolvedValue({ id: "turn-1" }) },
    agentToolCall: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    agentRunCheckpoint: { create: vi.fn().mockResolvedValue({ id: "checkpoint-1" }) },
  };
  const client = {
    $transaction: vi.fn(async (operation: (value: typeof tx) => unknown) => operation(tx)),
    agentRunCheckpoint: { findFirst: vi.fn() },
    agentToolCall: { findMany: vi.fn() },
  };
  return { tx, client, repository: new RuntimeRepository(client as never) };
}

const guard = { runId: "run-1", owner: "worker-1", leaseGeneration: 3, now: new Date("2026-09-01T00:00:00Z") };
const turnInput = {
  turn: {
    number: 1,
    inputDigest: "input-digest",
    request: { model: "model", messages: [{ role: "user" as const, content: "hello" }] },
    response: {
      id: "provider-response",
      content: [{ type: "text" as const, text: "complete response" }],
      toolCalls: [{ id: "call-1", name: "lookup", arguments: { q: "hello" } }],
      finishReason: "tool_calls",
    },
    usage: { inputTokens: 2, outputTokens: 3 },
  },
  prefixDigest: "prefix-digest",
  loadedSkillIds: ["skill@1"],
  loadedToolSchemaIds: ["lookup@1"],
  pendingToolCalls: [{
    id: "call-1", toolId: "lookup", toolVersion: "1", arguments: { q: "hello" },
    argumentsDigest: "args-digest", risk: "LOW", concurrency: "PARALLEL", idempotencyKey: "idem-1",
  }],
  checkpoint: {
    taskDigest: "task", contextGeneration: 1, skillBundleHash: "skill", mcpBundleDigest: "mcp",
    loadedSkillIds: ["skill@1"], loadedToolSchemaIds: ["lookup@1"], cumulativeUsage: { inputTokens: 2, outputTokens: 3 },
  },
};

describe("RuntimeRepository", () => {
  it("atomically commits a complete turn, pending calls, event, and checkpoint", async () => {
    const { repository, tx } = setup();
    const result = await repository.commitTurn(guard, turnInput);

    expect(result.eventSequence).toBe(5);
    expect(tx.agentRunTurn.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "COMPLETED", assistantContent: [{ type: "text", text: "complete response" }] }),
    }));
    expect(tx.agentToolCall.createMany).toHaveBeenCalledOnce();
    expect(tx.agentRunEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sequence: 5 }) }));
    expect(tx.agentRunCheckpoint.create).toHaveBeenCalledOnce();
  });

  it("stops all durable response writes when the lease is lost", async () => {
    const { repository, tx } = setup();
    tx.aiRun.updateMany.mockResolvedValue({ count: 0 });

    await expect(repository.commitTurn(guard, turnInput)).rejects.toBeInstanceOf(LeaseLostError);
    expect(tx.agentRunTurn.create).not.toHaveBeenCalled();
    expect(tx.agentRunEvent.create).not.toHaveBeenCalled();
    expect(tx.agentRunCheckpoint.create).not.toHaveBeenCalled();
  });

  it("does not advance to checkpoint when the complete-turn event fails", async () => {
    const { repository, tx } = setup();
    tx.agentRunEvent.create.mockRejectedValue(new Error("database_disconnected"));

    await expect(repository.commitTurn(guard, turnInput)).rejects.toThrow("database_disconnected");
    expect(tx.agentRunCheckpoint.create).not.toHaveBeenCalled();
  });

  it("retries allocation after a concurrent sequence unique conflict", async () => {
    const { repository, client, tx } = setup();
    client.$transaction
      .mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }))
      .mockImplementation(async (operation: (value: typeof tx) => unknown) => operation(tx));

    await repository.appendDelta(guard, { text: "batched", byteLength: 7 });
    expect(client.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.agentRunEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "assistant.delta", payload: { text: "batched", byteLength: 7 } }),
    }));
  });

  it("loads the latest matching checkpoint", async () => {
    const { repository, client } = setup();
    client.agentRunCheckpoint.findFirst.mockResolvedValue({
      eventSequence: 8, taskDigest: "task", skillBundleHash: "skill", mcpBundleDigest: "mcp", turn: { turnIndex: 2 },
    });

    await expect(repository.loadLatestCheckpoint("run-1", {
      taskDigest: "task", skillBundleHash: "skill", mcpBundleDigest: "mcp",
    })).resolves.toEqual(expect.objectContaining({ eventSequence: 8 }));
  });

  it("rejects resume with a disclosed continuity gap on digest mismatch", async () => {
    const { repository, client } = setup();
    client.agentRunCheckpoint.findFirst.mockResolvedValue({
      eventSequence: 8, taskDigest: "old-task", skillBundleHash: "skill", mcpBundleDigest: "old-mcp", turn: {},
    });

    const error = await repository.loadLatestCheckpoint("run-1", {
      taskDigest: "task", skillBundleHash: "skill", mcpBundleDigest: "mcp",
    }).catch((value) => value);
    expect(error).toBeInstanceOf(ResumeDigestMismatchError);
    expect(error).toMatchObject({ continuity: "GAP", mismatches: ["task", "mcp"] });
  });

  it("classifies pending and interrupted tool calls without replaying completed calls", async () => {
    const { repository, client } = setup();
    client.agentToolCall.findMany.mockResolvedValue([
      { id: "pending", status: "PENDING", idempotencyKey: null },
      { id: "safe-running", status: "RUNNING", idempotencyKey: "idem-safe" },
      { id: "unsafe-running", status: "RUNNING", idempotencyKey: null },
    ]);

    await expect(repository.pendingToolActions("run-1")).resolves.toEqual([
      { action: "RESUME", toolCallId: "pending" },
      { action: "RETRY_IDEMPOTENT", toolCallId: "safe-running", idempotencyKey: "idem-safe" },
      { action: "BLOCK", toolCallId: "unsafe-running", reason: "UNKNOWN_SIDE_EFFECT" },
    ]);
    expect(client.agentToolCall.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { runId: "run-1", status: { in: ["PENDING", "RUNNING"] } },
    }));
  });
});
