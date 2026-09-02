import { Prisma, type PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import type { DeltaBatch } from "../loop";
import { LeaseLostError, ResumeDigestMismatchError } from "./errors";
import type { CommitTurnInput, LeaseGuard, ResumeDigests, ToolResumeAction } from "./types";

type TransactionClient = Prisma.TransactionClient;
type DatabaseClient = Pick<PrismaClient, "$transaction"> & {
  agentRunCheckpoint: PrismaClient["agentRunCheckpoint"];
  agentToolCall: PrismaClient["agentToolCall"];
};

const MAX_SEQUENCE_RETRIES = 5;

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
    || (typeof error === "object" && error !== null && "code" in error && error.code === "P2002");
}

async function assertLease(tx: TransactionClient, guard: LeaseGuard) {
  const claimed = await tx.aiRun.updateMany({
    where: {
      id: guard.runId,
      owner: guard.owner,
      leaseGeneration: guard.leaseGeneration,
      leaseExpiresAt: { gt: guard.now ?? new Date() },
    },
    // A guarded no-op update serializes competing writers without advancing state.
    data: { owner: guard.owner },
  });
  if (claimed.count !== 1) throw new LeaseLostError(guard.runId);
}

async function nextSequence(tx: TransactionClient, runId: string) {
  const latest = await tx.agentRunEvent.findFirst({
    where: { runId },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  return (latest?.sequence ?? -1) + 1;
}

function eventPayload(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export class RuntimeRepository {
  constructor(private readonly client: DatabaseClient = db) {}

  private async retrySequence<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (!isUniqueConflict(error) || attempt >= MAX_SEQUENCE_RETRIES - 1) throw error;
      }
    }
  }

  async appendDelta(guard: LeaseGuard, batch: DeltaBatch) {
    return this.retrySequence(() => this.client.$transaction(async (tx) => {
      await assertLease(tx, guard);
      const sequence = await nextSequence(tx, guard.runId);
      return tx.agentRunEvent.create({
        data: { runId: guard.runId, sequence, type: "assistant.delta", payload: eventPayload(batch) },
      });
    }));
  }

  async commitTurn(guard: LeaseGuard, input: CommitTurnInput) {
    return this.retrySequence(() => this.client.$transaction(async (tx) => {
      await assertLease(tx, guard);
      const sequence = await nextSequence(tx, guard.runId);
      const { turn } = input;
      const committed = await tx.agentRunTurn.create({
        data: {
          runId: guard.runId,
          turnIndex: turn.number,
          inputDigest: turn.inputDigest,
          prefixDigest: input.prefixDigest,
          loadedSkillIds: input.loadedSkillIds,
          loadedToolSchemaIds: input.loadedToolSchemaIds,
          providerRequestId: turn.response.id,
          status: "COMPLETED",
          assistantContent: eventPayload(turn.response.content),
          thinking: input.thinking,
          thinkingContinuity: input.thinkingContinuity ?? "NONE",
          finishReason: turn.response.finishReason,
          usage: eventPayload(turn.usage),
          completedAt: guard.now ?? new Date(),
        },
      });
      if (input.pendingToolCalls?.length) {
        await tx.agentToolCall.createMany({
          data: input.pendingToolCalls.map((call) => ({ ...call, runId: guard.runId, turnIndex: turn.number })),
        });
      }
      await tx.agentRunEvent.create({
        data: {
          runId: guard.runId,
          sequence,
          type: "turn.completed",
          payload: eventPayload({ turnIndex: turn.number, inputDigest: turn.inputDigest }),
        },
      });
      if (input.checkpoint) {
        const checkpoint = input.checkpoint;
        await tx.agentRunCheckpoint.create({
          data: {
            runId: guard.runId,
            turnIndex: turn.number,
            eventSequence: sequence,
            runtimeSessionId: checkpoint.runtimeSessionId,
            taskDigest: checkpoint.taskDigest,
            contextGeneration: checkpoint.contextGeneration,
            skillBundleHash: checkpoint.skillBundleHash,
            mcpBundleDigest: checkpoint.mcpBundleDigest,
            loadedSkillIds: checkpoint.loadedSkillIds,
            loadedToolSchemaIds: checkpoint.loadedToolSchemaIds,
            inboundSequence: checkpoint.inboundSequence ?? 0,
            cumulativeUsage: checkpoint.cumulativeUsage,
            summary: checkpoint.summary,
          },
        });
        await tx.aiRun.updateMany({
          where: { id: guard.runId, owner: guard.owner, leaseGeneration: guard.leaseGeneration },
          data: { checkpointSequence: sequence },
        });
      }
      return { turn: committed, eventSequence: sequence };
    }));
  }

  async loadLatestCheckpoint(runId: string, expected: ResumeDigests) {
    const checkpoint = await this.client.agentRunCheckpoint.findFirst({
      where: { runId },
      orderBy: { eventSequence: "desc" },
      include: { turn: true },
    });
    if (!checkpoint) return null;
    const mismatches: ("task" | "skill" | "mcp")[] = [];
    if (checkpoint.taskDigest !== expected.taskDigest) mismatches.push("task");
    if (checkpoint.skillBundleHash !== expected.skillBundleHash) mismatches.push("skill");
    if (checkpoint.mcpBundleDigest !== expected.mcpBundleDigest) mismatches.push("mcp");
    if (mismatches.length) throw new ResumeDigestMismatchError(mismatches);
    return checkpoint;
  }

  async pendingToolActions(runId: string): Promise<ToolResumeAction[]> {
    const calls = await this.client.agentToolCall.findMany({
      where: { runId, status: { in: ["PENDING", "RUNNING"] } },
      orderBy: { createdAt: "asc" },
      select: { id: true, status: true, idempotencyKey: true },
    });
    return calls.map((call) => {
      if (call.status === "PENDING") return { action: "RESUME", toolCallId: call.id };
      if (call.idempotencyKey) return { action: "RETRY_IDEMPOTENT", toolCallId: call.id, idempotencyKey: call.idempotencyKey };
      return { action: "BLOCK", toolCallId: call.id, reason: "UNKNOWN_SIDE_EFFECT" };
    });
  }
}

