import { AiRunStatus, MessageKind } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { projectFinalMessage } from "./result-projector";

function database() {
  const tx = {
    aiRun: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    roomMember: { findFirst: vi.fn() },
    room: { update: vi.fn() },
    message: { create: vi.fn() },
    agentRunEvent: { findFirst: vi.fn(), create: vi.fn() },
    outboxEvent: { create: vi.fn() },
  };
  return { tx, db: { $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) } };
}

const input = {
  runId: "run-1",
  roomId: "room-1",
  targetMemberId: "member-1",
  membershipVersion: 2,
  owner: "worker-1",
  leaseGeneration: 3,
  triggerMessageId: "trigger-1",
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  body: "done",
};

describe("result projector", () => {
  it("returns the existing final message without creating another projection", async () => {
    const { tx, db } = database();
    tx.aiRun.findUnique.mockResolvedValue({ responseMessage: { id: "message-existing" } });

    const result = await projectFinalMessage(input, db as never);

    expect(result).toEqual({ message: { id: "message-existing" }, created: false });
    expect(tx.message.create).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });

  it("atomically commits the final message, execution fact, and stable outbox event", async () => {
    const { tx, db } = database();
    tx.aiRun.findUnique.mockResolvedValue({ responseMessage: null });
    tx.roomMember.findFirst.mockResolvedValue({ id: "member-1", version: 2 });
    tx.aiRun.updateMany.mockResolvedValue({ count: 1 });
    tx.room.update.mockResolvedValue({ lastSequence: 9 });
    tx.message.create.mockResolvedValue({ id: "message-1" });
    tx.agentRunEvent.findFirst.mockResolvedValue({ sequence: 3 });

    await expect(projectFinalMessage(input, db as never)).resolves.toEqual({ message: { id: "message-1" }, created: true });

    expect(tx.aiRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: AiRunStatus.RUNNING, responseMessageId: null }) }));
    expect(tx.message.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: MessageKind.AI, roomSequence: 9 }) });
    expect(tx.agentRunEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ sequence: 4, type: "run.completed" }) });
    expect(tx.outboxEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "agent_done", messageId: "message-1" }) });
  });
});
