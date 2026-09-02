import { type AiRunStatus, type PrismaClient } from "@prisma/client";
import { db } from "../../db.ts";
import { TERMINAL_RUN_STATUSES, type RetentionPlan, type RetentionStore } from "./types.ts";

type Client = Pick<PrismaClient, "$transaction" | "agentRunEvent" | "agentRunTurn">;
const terminal = TERMINAL_RUN_STATUSES as unknown as AiRunStatus[];

export class PrismaRetentionStore implements RetentionStore {
  private readonly client: Client;

  constructor(client: Client = db) {
    this.client = client;
  }

  async plan(cutoff: Date): Promise<RetentionPlan> {
    const runFilter = { status: { in: terminal }, updatedAt: { lt: cutoff } };
    const [deltaEvents, turns] = await Promise.all([
      this.client.agentRunEvent.findMany({
        where: { type: "assistant.delta", createdAt: { lt: cutoff }, checkpoints: { none: {} }, run: runFilter },
        select: { id: true, runId: true, createdAt: true }, orderBy: { id: "asc" },
      }),
      this.client.agentRunTurn.findMany({
        where: { completedAt: { lt: cutoff }, checkpoints: { none: {} }, run: runFilter },
        select: { id: true, runId: true, startedAt: true }, orderBy: { id: "asc" },
      }),
    ]);
    return { cutoff, deltaEvents, turns: turns.map(({ startedAt, ...turn }) => ({ ...turn, createdAt: startedAt })) };
  }

  async remove(plan: RetentionPlan) {
    const runFilter = { status: { in: terminal }, updatedAt: { lt: plan.cutoff } };
    return this.client.$transaction(async (tx) => {
      const deltaEvents = plan.deltaEvents.length ? await tx.agentRunEvent.deleteMany({
        where: { id: { in: plan.deltaEvents.map(({ id }) => id) }, type: "assistant.delta", checkpoints: { none: {} }, run: runFilter },
      }) : { count: 0 };
      const turns = plan.turns.length ? await tx.agentRunTurn.deleteMany({
        where: { id: { in: plan.turns.map(({ id }) => id) }, checkpoints: { none: {} }, run: runFilter },
      }) : { count: 0 };
      return { deltaEvents: deltaEvents.count, turns: turns.count };
    });
  }
}
