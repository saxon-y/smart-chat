import { AiRunMode, AiRunStatus, type PrismaClient } from "@prisma/client";

import { db } from "@/lib/db";

const DEFAULT_LEASE_MS = 10 * 60 * 1000;
const MAX_ACTIVE_PER_ROOM = 2;
const MAX_ACTIVE_PER_AGENT = 1;

type Database = Pick<PrismaClient, "$transaction">;

export async function claimAiRun(
  runId: string,
  owner: string,
  options: { database?: Database; now?: Date; leaseMs?: number } = {},
) {
  const database = options.database ?? db;
  const now = options.now ?? new Date();
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;

  return database.$transaction(async (tx) => {
    const candidate = await tx.aiRun.findUnique({
      where: { id: runId },
      select: { roomId: true, mode: true, targetAgentId: true, runtimeKind: true },
    });
    if (!candidate || (candidate.runtimeKind && candidate.runtimeKind !== "legacy")) return false;

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${candidate.roomId}))`;
    const activeStatuses: AiRunStatus[] = [AiRunStatus.CLAIMED, AiRunStatus.RUNNING];
    const activeRoom = await tx.aiRun.count({ where: { roomId: candidate.roomId, status: { in: activeStatuses } } });
    if (candidate.mode !== AiRunMode.SUPERVISOR && activeRoom >= MAX_ACTIVE_PER_ROOM) return false;
    if (candidate.targetAgentId) {
      const activeAgent = await tx.aiRun.count({ where: { targetAgentId: candidate.targetAgentId, status: { in: activeStatuses } } });
      if (activeAgent >= MAX_ACTIVE_PER_AGENT) return false;
    }
    if (candidate.mode === AiRunMode.SUPERVISOR) {
      const roomHead = await tx.aiRun.findFirst({
        where: {
          roomId: candidate.roomId,
          mode: AiRunMode.SUPERVISOR,
          status: { in: [AiRunStatus.PENDING, AiRunStatus.CLAIMED, AiRunStatus.RUNNING, AiRunStatus.FAILED_RETRYABLE] },
        },
        orderBy: { triggerMessage: { roomSequence: "asc" } },
        select: { id: true },
      });
      if (roomHead?.id !== runId) return false;
    }

    const result = await tx.aiRun.updateMany({
      where: {
        id: runId,
        OR: [
          { status: AiRunStatus.PENDING },
          { status: AiRunStatus.FAILED_RETRYABLE, nextRetryAt: { lte: now } },
          { status: { in: [AiRunStatus.CLAIMED, AiRunStatus.RUNNING] }, leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        status: AiRunStatus.CLAIMED,
        owner,
        leaseGeneration: { increment: 1 },
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
        attempt: { increment: 1 },
      },
    });
    if (result.count === 1) {
      const latest = await tx.agentRunEvent.findFirst({ where: { runId }, orderBy: { sequence: "desc" }, select: { sequence: true } });
      await tx.agentRunEvent.create({ data: { runId, sequence: (latest?.sequence ?? -1) + 1, type: "run.claimed", payload: { owner } } });
    }
    return result.count === 1;
  });
}
