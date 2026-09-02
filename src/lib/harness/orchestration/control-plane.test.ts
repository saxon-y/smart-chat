import { AiRunStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { cancelRun } from "./cancellation";
import { recoverRuns } from "./recovery";

describe("control-plane transactions", () => {
  it("records cancellation as a run fact and emits one stable business event", async () => {
    const tx = {
      aiRun: { findFirst: vi.fn().mockResolvedValue({ id: "run-1", status: AiRunStatus.RUNNING, targetAgentId: "agent-1" }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      agentRunEvent: { findFirst: vi.fn().mockResolvedValue({ sequence: 1 }), create: vi.fn() },
      outboxEvent: { create: vi.fn() },
    };
    const database = { $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };

    await cancelRun("room-1", "run-1", database as never);

    expect(tx.agentRunEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "run.cancelled", sequence: 2 }) });
    expect(tx.outboxEvent.create).toHaveBeenCalledOnce();
  });

  it("scans all recoverable states and dispatches each selected run", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "run-1" }, { id: "run-2" }]);
    const processRun = vi.fn().mockResolvedValue(undefined);

    await expect(recoverRuns(processRun, 2, { database: { aiRun: { findMany } } as never, now: new Date("2026-09-01T00:00:00.000Z") })).resolves.toBe(2);

    expect(processRun).toHaveBeenCalledTimes(2);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }));
  });
});
