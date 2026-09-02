import type { BarrierPolicy } from "./execution-plan";

export type ChildRunState = "PENDING" | "READY" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
export type FailurePolicy = "FAIL_FAST" | "CONTINUE" | "OPTIONAL";

export type BarrierChild = {
  runId: string;
  state: ChildRunState;
  failurePolicy: FailurePolicy;
};

export type BarrierDecision =
  | { action: "WAIT" }
  | { action: "AGGREGATE"; successfulRunIds: string[]; failedRunIds: string[] }
  | { action: "FAIL"; reason: "FAIL_FAST" | "BARRIER_UNSATISFIABLE"; cancelRunIds: string[] };

const terminalStates = new Set<ChildRunState>(["SUCCEEDED", "FAILED", "CANCELLED"]);

export function decideBarrier(policy: BarrierPolicy, children: readonly BarrierChild[]): BarrierDecision {
  const ids = new Set<string>();
  for (const child of children) {
    if (ids.has(child.runId)) throw new Error(`barrier_duplicate_child:${child.runId}`);
    ids.add(child.runId);
  }

  const failed = children.filter((child) => child.state === "FAILED" || child.state === "CANCELLED");
  const failFast = failed.find((child) => child.failurePolicy === "FAIL_FAST");
  if (failFast) {
    return {
      action: "FAIL",
      reason: "FAIL_FAST",
      cancelRunIds: children.filter((child) => !terminalStates.has(child.state)).map((child) => child.runId),
    };
  }

  const relevant = children.filter((child) => child.failurePolicy !== "OPTIONAL");
  const successful = children.filter((child) => child.state === "SUCCEEDED");
  const pending = children.filter((child) => !terminalStates.has(child.state));
  const successfulIds = successful.map((child) => child.runId);
  const failedIds = failed.map((child) => child.runId);

  let satisfied = false;
  let possible = true;
  switch (policy.type) {
    case "ALL":
      satisfied = relevant.every((child) => child.state === "SUCCEEDED" || (child.failurePolicy === "CONTINUE" && terminalStates.has(child.state)));
      possible = relevant.every((child) => child.failurePolicy === "CONTINUE" || child.state === "SUCCEEDED" || !terminalStates.has(child.state));
      break;
    case "ANY":
      satisfied = successful.length > 0;
      possible = satisfied || pending.length > 0;
      break;
    case "QUORUM":
      satisfied = successful.length >= policy.minimum;
      possible = successful.length + pending.length >= policy.minimum;
      break;
    case "REQUIRED": {
      const byId = new Map(children.map((child) => [child.runId, child]));
      if (policy.runIds.some((runId) => !byId.has(runId))) throw new Error(`barrier_missing_required_child:${policy.runIds.find((runId) => !byId.has(runId))}`);
      satisfied = policy.runIds.every((runId) => byId.get(runId)?.state === "SUCCEEDED");
      possible = policy.runIds.every((runId) => {
        const child = byId.get(runId)!;
        return child.state === "SUCCEEDED" || !terminalStates.has(child.state);
      });
      break;
    }
  }

  if (satisfied) return { action: "AGGREGATE", successfulRunIds: successfulIds, failedRunIds: failedIds };
  if (!possible) return { action: "FAIL", reason: "BARRIER_UNSATISFIABLE", cancelRunIds: pending.map((child) => child.runId) };
  return { action: "WAIT" };
}
