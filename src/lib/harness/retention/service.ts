import { randomUUID } from "node:crypto";
import type { RetentionStore, RetentionSummary } from "./types.ts";

export interface RetentionOptions { retentionDays: number; dryRun?: boolean; now?: Date }

export async function cleanupRuntimeRecords(store: RetentionStore, options: RetentionOptions): Promise<RetentionSummary> {
  if (!Number.isInteger(options.retentionDays) || options.retentionDays < 1) throw new Error("retention_days_must_be_a_positive_integer");
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - options.retentionDays * 86_400_000);
  const plan = await store.plan(cutoff);
  const dryRun = options.dryRun !== false;
  const deleted = dryRun ? { deltaEvents: 0, turns: 0 } : await store.remove(plan);
  return {
    auditVersion: 1,
    auditId: randomUUID(),
    generatedAt: now.toISOString(),
    cutoff: cutoff.toISOString(),
    retentionDays: options.retentionDays,
    dryRun,
    candidates: { deltaEvents: plan.deltaEvents.length, turns: plan.turns.length },
    deleted,
    targetIds: { deltaEvents: plan.deltaEvents.map(({ id }) => id), turns: plan.turns.map(({ id }) => id) },
  };
}
