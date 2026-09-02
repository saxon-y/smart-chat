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
    const room = await tx.room.update({ where: { id: input.roomId }, data: { lastSequence: { increment: 1 } }, select: { lastSequence: true } });
    const message = await tx.message.create({ data: { roomId: input.roomId, senderMemberId: target.id, kind: MessageKind.AI, body: input.body, contentParts: input.contentParts, roomSequence: room.lastSequence, replyToId: input.triggerMessageId } });
    await tx.aiRun.update({ where: { id: input.runId }, data: { responseMessageId: message.id } });
    const latest = await tx.agentRunEvent.findFirst({ where: { runId: input.runId }, orderBy: { sequence: "desc" }, select: { sequence: true } });
    await tx.agentRunEvent.create({ data: { runId: input.runId, sequence: (latest?.sequence ?? -1) + 1, type: "run.completed", payload: { messageId: message.id, ...(input.artifactId ? { artifactId: input.artifactId } : {}) } } });
    await tx.outboxEvent.create({ data: { roomId: input.roomId, runId: input.runId, messageId: message.id, type: "agent_done", payload: { ok: true, status: "succeeded", ...(input.artifactId ? { artifactId: input.artifactId } : {}) } } });
    return { message, created: true };
  });
}
