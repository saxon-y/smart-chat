import { describe, expect, it } from "vitest";
import type { ExecutionPlan } from "./execution-plan";
import { RunDispatcher, type ChildRunSnapshot, type DispatchedChildRun, type RunDispatcherRepository } from "./run-dispatcher";

const deadlineAt = "2027-01-01T00:00:00.000Z";
const budget = { maxTokens: 10, maxCost: 1, maxTurns: 2, maxToolCalls: 3, deadlineAt };
const plan: ExecutionPlan = {
  protocolVersion: "smart-chat-execution-plan/v1",
  parentRunId: "parent",
  parentBudget: { maxTokens: 20, maxCost: 2, maxTurns: 4, maxToolCalls: 6, deadlineAt },
  nodes: [
    { id: "research", agentId: "a", objective: "research", dependsOn: [], failurePolicy: "FAIL_FAST", runtimeRequirements: { kinds: ["EMBEDDED"], capabilities: [], modalities: ["text"], providerIds: [] }, budget },
    { id: "write", agentId: "b", objective: "write", dependsOn: ["research"], failurePolicy: "FAIL_FAST", runtimeRequirements: { kinds: ["EMBEDDED"], capabilities: [], modalities: ["text"], providerIds: [] }, budget },
  ],
  barrier: { type: "ALL" },
};

class MemoryRepository implements RunDispatcherRepository {
  children: DispatchedChildRun[] = [];
  nextId = 1;

  async createChildIfAbsent(snapshot: ChildRunSnapshot) {
    const existing = this.children.find((child) => child.parentRunId === snapshot.parentRunId && child.nodeId === snapshot.nodeId);
    if (existing) return existing;
    const child = { id: `child-${this.nextId++}`, parentRunId: snapshot.parentRunId, nodeId: snapshot.nodeId, state: "PENDING" as const, snapshot };
    this.children.push(child);
    return child;
  }
  async listChildren(parentRunId: string) { return this.children.filter((child) => child.parentRunId === parentRunId); }
  async markReadyIfDependenciesSucceeded(input: { parentRunId: string; childRunId: string; dependencyNodeIds: readonly string[] }) {
    const child = this.children.find((item) => item.id === input.childRunId && item.parentRunId === input.parentRunId);
    if (!child || child.state !== "PENDING") return false;
    const ready = input.dependencyNodeIds.every((nodeId) => this.children.some((item) => item.parentRunId === input.parentRunId && item.nodeId === nodeId && item.state === "SUCCEEDED"));
    if (!ready) return false;
    this.children = this.children.map((item) => item.id === child.id ? { ...item, state: "READY" } : item);
    return true;
  }
  async cancelUnfinishedChildren(parentRunId: string) {
    let count = 0;
    this.children = this.children.map((child) => {
      if (child.parentRunId !== parentRunId || ["SUCCEEDED", "FAILED", "CANCELLED"].includes(child.state)) return child;
      count += 1;
      return { ...child, state: "CANCELLED" };
    });
    return count;
  }
}

describe("RunDispatcher", () => {
  it("creates children idempotently and only readies satisfied nodes", async () => {
    const repository = new MemoryRepository();
    const dispatcher = new RunDispatcher(repository);
    await dispatcher.dispatch(plan, (node) => ({ agent: { id: node.agentId } }));
    await dispatcher.dispatch(plan, (node) => ({ agent: { id: node.agentId } }));
    expect(repository.children).toHaveLength(2);
    expect(repository.children.map((child) => [child.nodeId, child.state])).toEqual([["research", "READY"], ["write", "PENDING"]]);

    repository.children = repository.children.map((child) => child.nodeId === "research" ? { ...child, state: "SUCCEEDED" } : child);
    await dispatcher.dispatch(plan, (node) => ({ agent: { id: node.agentId } }));
    expect(repository.children.find((child) => child.nodeId === "write")?.state).toBe("READY");
  });

  it("freezes independent child state and propagates parent cancellation", async () => {
    const repository = new MemoryRepository();
    const dispatcher = new RunDispatcher(repository);
    const messages = [{ role: "user", content: "before" }];
    await dispatcher.dispatch(plan, (node) => ({ agent: { id: node.agentId }, modelMessages: messages }));
    messages[0].content = "after";
    expect(repository.children[0].snapshot.modelMessages[0]).toEqual({ role: "user", content: "before" });
    expect(repository.children[0].snapshot.modelMessages).not.toBe(repository.children[1].snapshot.modelMessages);
    expect(repository.children.every((child) => child.snapshot.toolCallCount === 0)).toBe(true);
    await expect(dispatcher.cancelParent("parent")).resolves.toBe(2);
    expect(repository.children.every((child) => child.state === "CANCELLED")).toBe(true);
  });
});
