import { describe, expect, it, vi } from "vitest";
import type { ContextBlock } from "../protocol";
import { buildContextBundle, hasInstructionAuthority, type PlannerContextBlock } from ".";

function block(overrides: Partial<PlannerContextBlock> & Pick<PlannerContextBlock, "id" | "kind">): PlannerContextBlock {
  return {
    origin: "retrieval",
    priority: 0,
    tokenEstimate: 10,
    content: overrides.id,
    ...overrides,
  };
}

describe("context planner", () => {
  it("filters unrelated rooms and deterministically orders and digests blocks", async () => {
    const blocks = [
      block({ id: "other", kind: "message", roomId: "room-2" }),
      block({ id: "message", kind: "message", roomId: "room-1", priority: 99 }),
      block({ id: "policy", kind: "policy", origin: "system_policy", priority: 1 }),
      block({ id: "task", kind: "task", origin: "user", priority: 1 }),
      block({ id: "skill", kind: "skill", origin: "skill", priority: 1 }),
    ];
    const first = await buildContextBundle({ objective: "ship", blocks }, { budget: 100, currentRoomId: "room-1" });
    const second = await buildContextBundle({ objective: "ship", blocks: [...blocks].reverse() }, { budget: 100, currentRoomId: "room-1" });

    expect(first.blocks.map(({ id }) => id)).toEqual(["policy", "task", "skill", "message"]);
    expect(second.digest).toBe(first.digest);
    expect(hasInstructionAuthority(first.blocks[0])).toBe(true);
    expect(hasInstructionAuthority(first.blocks[2])).toBe(false);
  });

  it("never silently prunes protected blocks and retains tool calls/results as a pair", async () => {
    const blocks = [
      block({ id: "policy", kind: "policy", origin: "system_policy", tokenEstimate: 10 }),
      block({ id: "call", kind: "message", origin: "tool", priority: -10, toolPairKey: "weather" }),
      block({ id: "result", kind: "tool-result", origin: "tool", priority: -10, toolPairKey: "weather" }),
      block({ id: "keep", kind: "message", origin: "user", priority: 5 }),
    ];
    const plan = await buildContextBundle({ objective: "ship", blocks }, { budget: 20 });

    expect(plan.blocks.map(({ id }) => id)).toEqual(["policy", "keep"]);
    expect(plan.decisions).toContainEqual({ type: "pruned", blockIds: ["call", "result"] });
  });

  it("externalizes large tool results before budgeting", async () => {
    const externalize = vi.fn().mockResolvedValue({ id: "artifact-1", mimeType: "application/json", byteSize: 1000 });
    const plan = await buildContextBundle({
      objective: "inspect",
      blocks: [block({ id: "result", kind: "tool-result", origin: "tool", tokenEstimate: 100 })],
    }, { budget: 10, externalizeAboveTokens: 50, externalizer: { externalize } });

    expect(externalize).toHaveBeenCalledOnce();
    expect(plan.blocks[0]).toMatchObject({ content: "[artifact:artifact-1]", sourceRef: "artifact:artifact-1", tokenEstimate: 8 });
    expect(plan.referencedArtifacts).toEqual([{ id: "artifact-1", mimeType: "application/json", byteSize: 1000 }]);
  });

  it("accepts structured compression while preserving protected content", async () => {
    const policy = block({ id: "policy", kind: "policy", origin: "system_policy", tokenEstimate: 10 });
    const memory = block({ id: "memory", kind: "memory", origin: "memory", tokenEstimate: 20, content: "long memory" });
    const plan = await buildContextBundle({ objective: "ship", blocks: [memory, policy] }, {
      budget: 20,
      compression: {
        compress: ({ blocks }) => blocks.map((item) => item.id === "memory"
          ? { ...item, content: "summary", tokenEstimate: 10 }
          : item),
      },
    });

    expect(plan.blocks).toEqual(expect.arrayContaining([policy, expect.objectContaining({ id: "memory", content: "summary" })]));
    expect(plan.decisions).toContainEqual({ type: "compressed", attempt: 1 });
  });

  it("stops after three failed compression attempts with a classified error", async () => {
    const compress = vi.fn(({ blocks }: { blocks: readonly ContextBlock[] }) => blocks);
    const promise = buildContextBundle({
      objective: "ship",
      blocks: [block({ id: "policy", kind: "policy", origin: "system_policy", tokenEstimate: 30 })],
    }, { budget: 10, compression: { compress } });

    await expect(promise).rejects.toMatchObject({
      code: "context_budget_exceeded",
      category: "CONTEXT",
    });
    expect(compress).toHaveBeenCalledTimes(3);
  });
});
