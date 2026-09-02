import { describe, expect, it, vi } from "vitest";
import { PrismaRetentionStore, TERMINAL_RUN_STATUSES, type RetentionPlan } from ".";

describe("PrismaRetentionStore", () => {
  it("plans only old terminal-run records without checkpoint references", async () => {
    const client = {
      agentRunEvent: { findMany: vi.fn().mockResolvedValue([{ id: "event-1", runId: "run-1", createdAt: new Date(0) }]) },
      agentRunTurn: { findMany: vi.fn().mockResolvedValue([{ id: "turn-1", runId: "run-1", startedAt: new Date(0) }]) },
      $transaction: vi.fn(),
    };
    const cutoff = new Date("2026-01-01");
    const result = await new PrismaRetentionStore(client as never).plan(cutoff);
    expect(result.turns[0]).toMatchObject({ id: "turn-1", createdAt: new Date(0) });
    expect(client.agentRunEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      type: "assistant.delta", checkpoints: { none: {} }, run: { status: { in: [...TERMINAL_RUN_STATUSES] }, updatedAt: { lt: cutoff } },
    }) }));
    expect(client.agentRunTurn.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ checkpoints: { none: {} } }) }));
  });

  it("rechecks terminal state and checkpoint references inside the delete transaction", async () => {
    const tx = {
      agentRunEvent: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      agentRunTurn: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const client = {
      agentRunEvent: { findMany: vi.fn() }, agentRunTurn: { findMany: vi.fn() },
      $transaction: vi.fn((callback) => callback(tx)),
    };
    const plan: RetentionPlan = {
      cutoff: new Date("2026-01-01"),
      deltaEvents: [{ id: "event-1", runId: "run-1", createdAt: new Date(0) }],
      turns: [{ id: "turn-1", runId: "run-1", createdAt: new Date(0) }],
    };
    expect(await new PrismaRetentionStore(client as never).remove(plan)).toEqual({ deltaEvents: 1, turns: 0 });
    expect(tx.agentRunEvent.deleteMany).toHaveBeenCalledWith({ where: expect.objectContaining({
      id: { in: ["event-1"] }, checkpoints: { none: {} }, run: { status: { in: [...TERMINAL_RUN_STATUSES] }, updatedAt: { lt: plan.cutoff } },
    }) });
    expect(tx.agentRunTurn.deleteMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: { in: ["turn-1"] }, checkpoints: { none: {} } }) });
  });
});
