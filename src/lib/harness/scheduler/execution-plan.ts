import { z } from "zod";
import { canonicalJson } from "../protocol/canonical";

export const runBudgetSchema = z.strictObject({
  maxTokens: z.number().int().nonnegative(),
  maxCost: z.number().nonnegative(),
  maxTurns: z.number().int().nonnegative(),
  maxToolCalls: z.number().int().nonnegative(),
  deadlineAt: z.string().datetime({ offset: true }),
});

export const runtimeRequirementsSchema = z.strictObject({
  kinds: z.array(z.enum(["EMBEDDED", "SELF_HOSTED", "DAEMON"])).min(1),
  capabilities: z.array(z.string().min(1)).default([]),
  modalities: z.array(z.enum(["text", "image"])).default(["text"]),
  providerIds: z.array(z.string().min(1)).default([]),
});

export const barrierPolicySchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("ALL") }),
  z.strictObject({ type: z.literal("ANY") }),
  z.strictObject({ type: z.literal("QUORUM"), minimum: z.number().int().positive() }),
  z.strictObject({ type: z.literal("REQUIRED"), runIds: z.array(z.string().min(1)).min(1) }),
]);

export const executionPlanNodeSchema = z.strictObject({
  id: z.string().min(1),
  agentId: z.string().min(1),
  objective: z.string().min(1),
  dependsOn: z.array(z.string().min(1)),
  failurePolicy: z.enum(["FAIL_FAST", "CONTINUE", "OPTIONAL"]),
  runtimeRequirements: runtimeRequirementsSchema,
  budget: runBudgetSchema,
});

const executionPlanShape = z.strictObject({
  protocolVersion: z.literal("smart-chat-execution-plan/v1"),
  parentRunId: z.string().min(1),
  parentBudget: runBudgetSchema,
  nodes: z.array(executionPlanNodeSchema).min(1),
  barrier: barrierPolicySchema,
});

const budgetFields = ["maxTokens", "maxCost", "maxTurns", "maxToolCalls"] as const;

export const executionPlanSchema = executionPlanShape.superRefine((plan, context) => {
  const ids = new Set<string>();
  for (let index = 0; index < plan.nodes.length; index += 1) {
    const node = plan.nodes[index];
    if (ids.has(node.id)) {
      context.addIssue({ code: "custom", message: `execution_plan_duplicate_node:${node.id}`, path: ["nodes", index, "id"] });
    }
    ids.add(node.id);
    if (Date.parse(node.budget.deadlineAt) > Date.parse(plan.parentBudget.deadlineAt)) {
      context.addIssue({ code: "custom", message: `execution_plan_deadline_exceeds_parent:${node.id}`, path: ["nodes", index, "budget", "deadlineAt"] });
    }
  }

  for (let index = 0; index < plan.nodes.length; index += 1) {
    for (const dependency of plan.nodes[index].dependsOn) {
      if (!ids.has(dependency)) {
        context.addIssue({ code: "custom", message: `execution_plan_missing_dependency:${dependency}`, path: ["nodes", index, "dependsOn"] });
      }
      if (dependency === plan.nodes[index].id) {
        context.addIssue({ code: "custom", message: `execution_plan_cycle:${dependency}`, path: ["nodes", index, "dependsOn"] });
      }
    }
  }

  if (plan.barrier.type === "QUORUM" && plan.barrier.minimum > plan.nodes.length) {
    context.addIssue({ code: "custom", message: "execution_plan_quorum_exceeds_nodes", path: ["barrier", "minimum"] });
  }
  if (plan.barrier.type === "REQUIRED") {
    const required = new Set<string>();
    for (const runId of plan.barrier.runIds) {
      if (required.has(runId)) context.addIssue({ code: "custom", message: `execution_plan_duplicate_required:${runId}`, path: ["barrier", "runIds"] });
      if (!ids.has(runId)) context.addIssue({ code: "custom", message: `execution_plan_missing_required:${runId}`, path: ["barrier", "runIds"] });
      required.add(runId);
    }
  }

  for (const field of budgetFields) {
    const allocated = plan.nodes.reduce((sum, node) => sum + node.budget[field], 0);
    if (allocated > plan.parentBudget[field]) {
      context.addIssue({ code: "custom", message: `execution_plan_budget_exceeds_parent:${field}`, path: ["parentBudget", field] });
    }
  }

  const adjacency = new Map(plan.nodes.map((node) => [node.id, node.dependsOn]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const cyclic = (adjacency.get(id) ?? []).some((dependency) => adjacency.has(dependency) && visit(dependency));
    visiting.delete(id);
    visited.add(id);
    return cyclic;
  };
  if (plan.nodes.some((node) => visit(node.id))) {
    context.addIssue({ code: "custom", message: "execution_plan_cycle", path: ["nodes"] });
  }
});

export type RunBudget = z.infer<typeof runBudgetSchema>;
export type RuntimeRequirements = z.infer<typeof runtimeRequirementsSchema>;
export type BarrierPolicy = z.infer<typeof barrierPolicySchema>;
export type ExecutionPlanNode = z.infer<typeof executionPlanNodeSchema>;
export type ExecutionPlan = z.infer<typeof executionPlanSchema>;

export function parseExecutionPlan(input: unknown): ExecutionPlan {
  return executionPlanSchema.parse(input);
}

export function serializeExecutionPlan(input: unknown): string {
  return canonicalJson(parseExecutionPlan(input));
}
