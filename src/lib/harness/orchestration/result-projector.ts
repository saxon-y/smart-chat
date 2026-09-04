import { AiRunStatus, MessageKind, type Prisma, type PrismaClient } from "@prisma/client";

import { db } from "@/lib/db";

type Database = Pick<PrismaClient, "$transaction">;

export type FinalMessageProjection = {
  runId: string;
  roomId: string;
  targetMemberId: string;
  membershipVersion: number | null;
  owner: string;
  leaseGeneration: number;
  triggerMessageId: string;
  threadId?: string | null;
  updatedAt: Date;
  body: string;
  contentParts?: Prisma.InputJsonValue;
  tokenUsage?: number;
  artifactId?: string;
};

export async function projectFinalMessage(input: FinalMessageProjection, database: Database = db) {
  return database.$transaction(async (tx) => {
    const existing = await tx.aiRun.findUnique({ where: { id: input.runId }, select: { responseMessage: true } });
    if (existing?.responseMessage) return { message: existing.responseMessage, created: false };
    const target = await tx.roomMember.findFirst({ where: { id: input.targetMemberId, roomId: input.roomId, leftAt: null } });
    if (!target || target.version !== input.membershipVersion) throw new Error("assistant_membership_changed");
    const claimed = await tx.aiRun.updateMany({
      where: { id: input.runId, owner: input.owner, leaseGeneration: input.leaseGeneration, status: AiRunStatus.RUNNING, leaseExpiresAt: { gt: new Date() }, responseMessageId: null },
      data: { status: AiRunStatus.SUCCEEDED, tokenUsage: input.tokenUsage, latencyMs: Date.now() - input.updatedAt.getTime(), leaseExpiresAt: null },
    });
    if (claimed.count !== 1) {
      const raced = await tx.aiRun.findUnique({ where: { id: input.runId }, select: { responseMessage: true } });
      if (raced?.responseMessage) return { message: raced.responseMessage, created: false };
      throw new Error("run_lease_lost");
    }
    let messageId: string;
    let message: { id: string };
    if (input.threadId) {
      const thread = await tx.thread.findFirst({ where: { id: input.threadId, roomId: input.roomId } });
      if (!thread) throw new Error("thread_not_found");
      const updated = await tx.thread.update({ where: { id: thread.id }, data: { lastSequence: { increment: 1 } } });
      const reply = await tx.threadReply.create({ data: { threadId: thread.id, roomId: input.roomId, senderMemberId: target.id, body: input.body, sequence: updated.lastSequence } });
      messageId = reply.id; message = reply;
    } else {
      const room = await tx.room.update({ where: { id: input.roomId }, data: { lastSequence: { increment: 1 } }, select: { lastSequence: true } });
      message = await tx.message.create({ data: { roomId: input.roomId, senderMemberId: target.id, kind: MessageKind.AI, body: input.body, contentParts: input.contentParts, roomSequence: room.lastSequence, replyToId: input.triggerMessageId } });
      messageId = message.id;
    }
    await tx.aiRun.update({ where: { id: input.runId }, data: { responseMessageId: input.threadId ? null : messageId } });
    const latest = await tx.agentRunEvent.findFirst({ where: { runId: input.runId }, orderBy: { sequence: "desc" }, select: { sequence: true } });
    await tx.agentRunEvent.create({ data: { runId: input.runId, sequence: (latest?.sequence ?? -1) + 1, type: "run.completed", payload: { messageId: message.id, ...(input.artifactId ? { artifactId: input.artifactId } : {}) } } });
    await tx.outboxEvent.create({ data: { roomId: input.roomId, runId: input.runId, messageId: message.id, type: "agent_done", payload: { ok: true, status: "succeeded", ...(input.artifactId ? { artifactId: input.artifactId } : {}) } } });
    return { message, created: true };
  });
}
