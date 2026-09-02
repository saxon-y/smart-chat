import { z } from "zod";
import { artifactRefSchema } from "../protocol/context";
import { decideBarrier, type BarrierChild } from "./barrier";
import type { BarrierPolicy } from "./execution-plan";

export const structuredHandoffSchema = z.strictObject({
  summary: z.string(),
  facts: z.array(z.record(z.string(), z.unknown())),
  decisions: z.array(z.record(z.string(), z.unknown())),
  artifacts: z.array(artifactRefSchema),
  warnings: z.array(z.string()),
  unresolved: z.array(z.string()),
});

export type StructuredHandoff = z.infer<typeof structuredHandoffSchema>;

export type AggregatorChild = BarrierChild & Readonly<{ handoff?: unknown }>;

export interface AggregatorRepository {
  listChildren(parentRunId: string): Promise<readonly AggregatorChild[]>;
  /** Must compare-and-set the parent from its aggregating state to completed. */
  completeParent(input: { parentRunId: string; result: AggregatedResult }): Promise<boolean>;
}

export interface ArtifactAuthorizer {
  canRead(input: { parentRunId: string; childRunId: string; artifactId: string }): Promise<boolean>;
}

export type AggregatedResult = Readonly<{
  summary: string;
  facts: readonly Record<string, unknown>[];
  decisions: readonly Record<string, unknown>[];
  artifacts: readonly z.infer<typeof artifactRefSchema>[];
  warnings: readonly string[];
  unresolved: readonly string[];
  sourceRunIds: readonly string[];
}>;

export type AggregateOutcome =
  | { status: "WAITING" }
  | { status: "FAILED"; reason: "FAIL_FAST" | "BARRIER_UNSATISFIABLE" }
  | { status: "COMPLETED"; result: AggregatedResult; committed: boolean };

export class RunAggregator {
  constructor(
    private readonly repository: AggregatorRepository,
    private readonly artifactAuthorizer: ArtifactAuthorizer,
  ) {}

  async aggregate(parentRunId: string, barrier: BarrierPolicy): Promise<AggregateOutcome> {
    const children = await this.repository.listChildren(parentRunId);
    const decision = decideBarrier(barrier, children);
    if (decision.action === "WAIT") return { status: "WAITING" };
    if (decision.action === "FAIL") return { status: "FAILED", reason: decision.reason };

    const successful = new Set(decision.successfulRunIds);
    const handoffs: Array<{ runId: string; value: StructuredHandoff }> = [];
    for (const child of children) {
      if (!successful.has(child.runId)) continue;
      handoffs.push({ runId: child.runId, value: structuredHandoffSchema.parse(child.handoff) });
    }

    for (const handoff of handoffs) {
      for (const artifact of handoff.value.artifacts) {
        if (!await this.artifactAuthorizer.canRead({ parentRunId, childRunId: handoff.runId, artifactId: artifact.id })) {
          throw new Error(`aggregator_artifact_forbidden:${artifact.id}`);
        }
      }
    }

    const result: AggregatedResult = Object.freeze({
      summary: handoffs.map(({ value }) => value.summary).filter(Boolean).join("\n\n"),
      facts: handoffs.flatMap(({ value }) => value.facts),
      decisions: handoffs.flatMap(({ value }) => value.decisions),
      artifacts: handoffs.flatMap(({ value }) => value.artifacts),
      warnings: handoffs.flatMap(({ value }) => value.warnings),
      unresolved: handoffs.flatMap(({ value }) => value.unresolved),
      sourceRunIds: handoffs.map(({ runId }) => runId),
    });
    const committed = await this.repository.completeParent({ parentRunId, result });
    return { status: "COMPLETED", result, committed };
  }
}
