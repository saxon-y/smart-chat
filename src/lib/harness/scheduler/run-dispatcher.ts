import type { ExecutionPlan, ExecutionPlanNode, RunBudget } from "./execution-plan";

export type DispatchState = "PENDING" | "READY" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

export type ChildRunSnapshot = Readonly<{
  parentRunId: string;
  nodeId: string;
  agent: Readonly<Record<string, unknown>>;
  objective: string;
  budget: Readonly<RunBudget>;
  runtimeRequirements: Readonly<ExecutionPlanNode["runtimeRequirements"]>;
  modelMessages: readonly Readonly<Record<string, unknown>>[];
  toolCallCount: number;
}>;

export type DispatchedChildRun = Readonly<{
  id: string;
  parentRunId: string;
  nodeId: string;
  state: DispatchState;
  snapshot: ChildRunSnapshot;
}>;

export interface RunDispatcherRepository {
  /** Must be unique on (parentRunId, nodeId). */
  createChildIfAbsent(snapshot: ChildRunSnapshot): Promise<DispatchedChildRun>;
  listChildren(parentRunId: string): Promise<readonly DispatchedChildRun[]>;
  /** Checks dependencies and changes PENDING -> READY in one transaction. */
  markReadyIfDependenciesSucceeded(input: {
    parentRunId: string;
    childRunId: string;
    dependencyNodeIds: readonly string[];
  }): Promise<boolean>;
  cancelUnfinishedChildren(parentRunId: string, reason: string): Promise<number>;
}

export type ChildSnapshotFactory = (node: ExecutionPlanNode) => {
  agent: Record<string, unknown>;
  modelMessages?: readonly Record<string, unknown>[];
};

function immutableClone<T>(value: T): T {
  const clone = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (!item || typeof item !== "object" || Object.isFrozen(item)) return;
    Object.freeze(item);
    for (const nested of Object.values(item)) freeze(nested);
  };
  freeze(clone);
  return clone;
}

export class RunDispatcher {
  constructor(private readonly repository: RunDispatcherRepository) {}

  async dispatch(plan: ExecutionPlan, snapshotFactory: ChildSnapshotFactory): Promise<readonly DispatchedChildRun[]> {
    for (const node of plan.nodes) {
      const source = snapshotFactory(node);
      await this.repository.createChildIfAbsent(immutableClone({
        parentRunId: plan.parentRunId,
        nodeId: node.id,
        agent: source.agent,
        objective: node.objective,
        budget: node.budget,
        runtimeRequirements: node.runtimeRequirements,
        modelMessages: source.modelMessages ?? [],
        toolCallCount: 0,
      }));
    }

    const children = await this.repository.listChildren(plan.parentRunId);
    const byNode = new Map(children.map((child) => [child.nodeId, child]));
    for (const node of plan.nodes) {
      const child = byNode.get(node.id);
      if (!child) throw new Error(`dispatcher_missing_child:${node.id}`);
      if (child.state === "PENDING") {
        await this.repository.markReadyIfDependenciesSucceeded({
          parentRunId: plan.parentRunId,
          childRunId: child.id,
          dependencyNodeIds: node.dependsOn,
        });
      }
    }
    return this.repository.listChildren(plan.parentRunId);
  }

  cancelParent(parentRunId: string): Promise<number> {
    return this.repository.cancelUnfinishedChildren(parentRunId, "parent_cancelled");
  }
}
