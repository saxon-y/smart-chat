import { AiRunStatus, type PrismaClient } from "@prisma/client";

import { db } from "@/lib/db";

type Database = Pick<PrismaClient, "$transaction">;

export function isRetryableLegacyError(errorCode: string) {
  return errorCode === "provider_request_failed" || errorCode.startsWith("provider_http_5") || errorCode === "provider_http_429";
}

export async function recordRunFailure(input: {
  runId: string;
  roomId: string;
  owner: string | null;
  leaseGeneration: number;
  attempt: number;
  errorCode: string;
}, database: Database = db) {
  const cancelled = ["assistant_membership_changed", "agent_not_available", "caller_membership_revoked"].includes(input.errorCode);
  const nextStatus = cancelled ? AiRunStatus.CANCELLED : isRetryableLegacyError(input.errorCode) && input.attempt < 3 ? AiRunStatus.FAILED_RETRYABLE : AiRunStatus.FAILED_FINAL;
  const changed = await database.$transaction(async (tx) => {
    const result = await tx.aiRun.updateMany({
      where: { id: input.runId, owner: input.owner, leaseGeneration: input.leaseGeneration, status: { in: [AiRunStatus.CLAIMED, AiRunStatus.RUNNING] } },
      data: { status: nextStatus, errorCode: input.errorCode, nextRetryAt: nextStatus === AiRunStatus.FAILED_RETRYABLE ? new Date(Date.now() + 2000 * 2 ** input.attempt) : null, leaseExpiresAt: null },
    });
    if (result.count !== 1) return result;
    const latest = await tx.agentRunEvent.findFirst({ where: { runId: input.runId }, orderBy: { sequence: "desc" }, select: { sequence: true } });
    await tx.agentRunEvent.create({ data: { runId: input.runId, sequence: (latest?.sequence ?? -1) + 1, type: nextStatus === AiRunStatus.FAILED_RETRYABLE ? "run.retry_scheduled" : "run.failed", payload: { status: nextStatus.toLowerCase(), errorCode: input.errorCode } } });
    if (nextStatus !== AiRunStatus.FAILED_RETRYABLE) await tx.outboxEvent.create({ data: { roomId: input.roomId, runId: input.runId, type: "agent_done", payload: { ok: false, status: nextStatus.toLowerCase(), error: input.errorCode } } });
    return result;
  }).catch(() => undefined);
  if (!changed || changed.count !== 1) throw new Error("run_lease_lost");
  return nextStatus;
}
