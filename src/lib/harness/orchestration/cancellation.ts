import { AiRunStatus, type PrismaClient } from "@prisma/client";

import { db } from "@/lib/db";

type Database = Pick<PrismaClient, "$transaction">;

export async function cancelRun(roomId: string, runId: string, database: Database = db) {
  return database.$transaction(async (tx) => {
    const run = await tx.aiRun.findFirst({ where: { id: runId, roomId }, select: { id: true, status: true, targetAgentId: true } });
    if (!run) return null;
    const cancellable: AiRunStatus[] = [AiRunStatus.PENDING, AiRunStatus.CLAIMED, AiRunStatus.RUNNING, AiRunStatus.FAILED_RETRYABLE, AiRunStatus.FAILED_FINAL];
    if (!cancellable.includes(run.status)) return run;
    const updated = await tx.aiRun.updateMany({
      where: { id: runId, roomId, status: run.status },
      data: { status: AiRunStatus.CANCELLED, owner: null, leaseExpiresAt: null, nextRetryAt: null, errorCode: "cancelled_by_user", cancelRequestedAt: new Date() },
    });
    if (updated.count !== 1) return null;
    const latest = await tx.agentRunEvent.findFirst({ where: { runId }, orderBy: { sequence: "desc" }, select: { sequence: true } });
    await tx.agentRunEvent.create({ data: { runId, sequence: (latest?.sequence ?? -1) + 1, type: "run.cancelled", payload: { reason: "cancelled_by_user" } } });
    await tx.outboxEvent.create({ data: { roomId, runId, type: "agent_done", payload: { ok: false, status: "cancelled", error: "cancelled_by_user" } } });
    return { ...run, status: AiRunStatus.CANCELLED };
  });
}

export async function retryRun(roomId: string, runId: string, database: Database = db) {
  return database.$transaction(async (tx) => {
    const run = await tx.aiRun.findFirst({ where: { id: runId, roomId }, select: { id: true, status: true, callerMember: { select: { leftAt: true, roomId: true } } } });
    if (!run) return null;
    if (run.callerMember.leftAt || run.callerMember.roomId !== roomId) throw new Error("caller_membership_revoked");
    const retryableStatuses: AiRunStatus[] = [AiRunStatus.FAILED_RETRYABLE, AiRunStatus.FAILED_FINAL, AiRunStatus.CANCELLED];
    if (!retryableStatuses.includes(run.status)) return run;
    const updated = await tx.aiRun.updateMany({
      where: { id: runId, roomId, status: run.status },
      data: { status: AiRunStatus.PENDING, owner: null, leaseExpiresAt: null, nextRetryAt: null, errorCode: null, cancelRequestedAt: null },
    });
    return updated.count === 1 ? { ...run, status: AiRunStatus.PENDING } : null;
  });
}
