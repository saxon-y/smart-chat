import { describe, expect, it, vi } from "vitest";
import type { TaskEnvelope } from "../../protocol";
import { EmbeddedSupervisorRuntime } from "./supervisor";

const candidate = { memberId: "member-1", agentKey: "writer", name: "Writer", capabilities: ["writing"] };

function task(agent: Record<string, unknown>): TaskEnvelope {
  return { runId: "parent-1", roomId: "room-1", triggerMessageId: "message-1", objective: "write", agent } as TaskEnvelope;
}

describe("EmbeddedSupervisorRuntime", () => {
  it("returns NO_ACTION without calling the model when no candidates exist", async () => {
    const route = vi.fn();
    const enqueue = vi.fn();
    const result = await (await new EmbeddedSupervisorRuntime({ route }, { enqueue }).execute(task({ candidates: [] }))).result;
    expect(result.decisions).toEqual([{ action: "NO_ACTION", confidence: 0, reasonCode: "NO_CANDIDATES" }]);
    expect(route).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("returns NO_ACTION below the configured confidence threshold", async () => {
    const route = vi.fn().mockResolvedValue({ content: JSON.stringify({ action: "DELEGATE", targetMemberId: "member-1", capability: "writing", confidence: 0.6, reasonCode: "MATCH" }) });
    const enqueue = vi.fn();
    const result = await (await new EmbeddedSupervisorRuntime({ route }, { enqueue }).execute(task({ candidates: [candidate], confidenceThreshold: 0.75 }))).result;
    expect(result.decisions[0]).toMatchObject({ action: "NO_ACTION", reasonCode: "BELOW_CONFIDENCE_THRESHOLD" });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("only requests an idempotent child dispatch and never executes the child inline", async () => {
    const route = vi.fn().mockResolvedValue({ content: JSON.stringify({ action: "DELEGATE", targetMemberId: "member-1", capability: "writing", confidence: 0.9, reasonCode: "MATCH" }) });
    const enqueue = vi.fn().mockResolvedValueOnce({ childRunId: "child-1", created: true }).mockResolvedValueOnce({ childRunId: "child-1", created: false });
    const runtime = new EmbeddedSupervisorRuntime({ route }, { enqueue });
    const first = await (await runtime.execute(task({ candidates: [candidate] }))).result;
    const resumed = await (await runtime.resume(task({ candidates: [candidate] }))).result;
    expect(enqueue).toHaveBeenNthCalledWith(1, expect.objectContaining({ idempotencyKey: "parent-1:member-1", parentRunId: "parent-1" }));
    expect(enqueue).toHaveBeenNthCalledWith(2, expect.objectContaining({ idempotencyKey: "parent-1:member-1", parentRunId: "parent-1" }));
    expect(first.decisions[0]).toMatchObject({ childRunId: "child-1", childCreated: true });
    expect(resumed.decisions[0]).toMatchObject({ childRunId: "child-1", childCreated: false });
  });
});
