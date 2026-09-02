import { describe, expect, it, vi } from "vitest";
import { RunAggregator, type AggregatorChild, type AggregatorRepository } from "./aggregator";

const handoff = {
  summary: "researched",
  facts: [{ claim: "fact" }],
  decisions: [{ choice: "ship" }],
  artifacts: [{ id: "artifact-1", mimeType: "text/plain" }],
  warnings: ["check source"],
  unresolved: ["follow up"],
};

function repository(children: AggregatorChild[]): AggregatorRepository & { completeParent: ReturnType<typeof vi.fn> } {
  return { listChildren: vi.fn().mockResolvedValue(children), completeParent: vi.fn().mockResolvedValue(true) };
}

describe("RunAggregator", () => {
  it("waits for the barrier without reading or completing partial output", async () => {
    const repo = repository([{ runId: "a", state: "RUNNING", failurePolicy: "FAIL_FAST", handoff }]);
    const authorizer = { canRead: vi.fn().mockResolvedValue(true) };
    await expect(new RunAggregator(repo, authorizer).aggregate("parent", { type: "ALL" })).resolves.toEqual({ status: "WAITING" });
    expect(authorizer.canRead).not.toHaveBeenCalled();
    expect(repo.completeParent).not.toHaveBeenCalled();
  });

  it("aggregates only structured handoffs and revalidates artifact access", async () => {
    const repo = repository([{ runId: "a", state: "SUCCEEDED", failurePolicy: "FAIL_FAST", handoff: { ...handoff, privateLog: "must not pass schema" } }]);
    const aggregator = new RunAggregator(repo, { canRead: vi.fn().mockResolvedValue(true) });
    await expect(aggregator.aggregate("parent", { type: "ALL" })).rejects.toThrow();

    repo.listChildren = vi.fn().mockResolvedValue([{ runId: "a", state: "SUCCEEDED", failurePolicy: "FAIL_FAST", handoff }]);
    const denied = new RunAggregator(repo, { canRead: vi.fn().mockResolvedValue(false) });
    await expect(denied.aggregate("parent", { type: "ALL" })).rejects.toThrow("aggregator_artifact_forbidden:artifact-1");
    expect(repo.completeParent).not.toHaveBeenCalled();
  });

  it("completes after the barrier with merged structured fields", async () => {
    const repo = repository([
      { runId: "a", state: "SUCCEEDED", failurePolicy: "FAIL_FAST", handoff },
      { runId: "b", state: "FAILED", failurePolicy: "OPTIONAL" },
    ]);
    const authorizer = { canRead: vi.fn().mockResolvedValue(true) };
    const outcome = await new RunAggregator(repo, authorizer).aggregate("parent", { type: "ALL" });
    expect(outcome).toMatchObject({ status: "COMPLETED", committed: true, result: { summary: "researched", sourceRunIds: ["a"] } });
    expect(authorizer.canRead).toHaveBeenCalledWith({ parentRunId: "parent", childRunId: "a", artifactId: "artifact-1" });
    expect(repo.completeParent).toHaveBeenCalledOnce();
  });
});
