import { describe, expect, it } from "vitest";
import { parseExecutionPlan, serializeExecutionPlan } from "./execution-plan";

const deadlineAt = "2027-01-01T00:00:00.000Z";

function node(id: string, dependsOn: string[] = []) {
  return {
    id,
    agentId: `agent-${id}`,
    objective: `execute ${id}`,
    dependsOn,
    failurePolicy: "FAIL_FAST" as const,
    runtimeRequirements: { kinds: ["EMBEDDED" as const] },
    budget: { maxTokens: 10, maxCost: 2, maxTurns: 1, maxToolCalls: 1, deadlineAt },
  };
}

function plan(nodes = [node("research"), node("writer", ["research"])]) {
  return {
    protocolVersion: "smart-chat-execution-plan/v1" as const,
    parentRunId: "parent",
    parentBudget: { maxTokens: 20, maxCost: 4, maxTurns: 2, maxToolCalls: 2, deadlineAt },
    nodes,
    barrier: { type: "ALL" as const },
  };
}

describe("execution plan", () => {
  it("parses a valid DAG and serializes it canonically", () => {
    const parsed = parseExecutionPlan(plan());
    expect(parsed.nodes[0].runtimeRequirements.modalities).toEqual(["text"]);
    expect(serializeExecutionPlan(plan())).toBe(serializeExecutionPlan({
      barrier: { type: "ALL" },
      nodes: plan().nodes,
      parentBudget: plan().parentBudget,
      parentRunId: "parent",
      protocolVersion: "smart-chat-execution-plan/v1",
    }));
  });

  it.each([
    ["missing dependency", plan([node("writer", ["missing"])]), "execution_plan_missing_dependency"],
    ["self cycle", plan([node("writer", ["writer"])]), "execution_plan_cycle"],
    ["multi-node cycle", plan([node("a", ["b"]), node("b", ["a"])]), "execution_plan_cycle"],
    ["duplicate node", plan([node("a"), node("a")]), "execution_plan_duplicate_node"],
  ])("rejects %s", (_name, input, message) => {
    expect(() => parseExecutionPlan(input)).toThrow(message);
  });

  it("rejects negative and aggregate parent-budget violations", () => {
    const negative = plan();
    negative.nodes[0].budget.maxTokens = -1;
    expect(() => parseExecutionPlan(negative)).toThrow();

    const exceeded = plan();
    exceeded.parentBudget.maxTokens = 19;
    expect(() => parseExecutionPlan(exceeded)).toThrow("execution_plan_budget_exceeds_parent:maxTokens");
  });

  it("rejects invalid barrier references and impossible quorum", () => {
    expect(() => parseExecutionPlan({ ...plan(), barrier: { type: "REQUIRED", runIds: ["missing"] } })).toThrow("execution_plan_missing_required");
    expect(() => parseExecutionPlan({ ...plan(), barrier: { type: "QUORUM", minimum: 3 } })).toThrow("execution_plan_quorum_exceeds_nodes");
  });
});
