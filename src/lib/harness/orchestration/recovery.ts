import { AiRunStatus, type PrismaClient } from "@prisma/client";

import { db } from "@/lib/db";

type Database = Pick<PrismaClient, "aiRun">;

export async function recoverRuns(
  processRun: (runId: string) => Promise<unknown>,
  limit = 20,
  options: { database?: Database; now?: Date } = {},
) {
  const database = options.database ?? db;
  const now = options.now ?? new Date();
  const runs = await database.aiRun.findMany({
    where: { OR: [{ status: AiRunStatus.PENDING }, { status: AiRunStatus.FAILED_RETRYABLE, nextRetryAt: { lte: now } }, { status: { in: [AiRunStatus.CLAIMED, AiRunStatus.RUNNING] }, leaseExpiresAt: { lt: now } }] },
    orderBy: [{ roomId: "asc" }, { createdAt: "asc" }],
    take: limit,
    select: { id: true },
  });
  await Promise.allSettled(runs.map((run) => processRun(run.id)));
  return runs.length;
}
