import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ExecutionPolicy } from "../protocol/policy";
import { ToolExecutor, type ToolSuccessResult } from "./executor";
import type { ToolCallLedger, ToolCallLedgerState } from "./idempotency";
import { ToolRegistry } from "./registry";

class MemoryLedger implements ToolCallLedger<ToolSuccessResult> {
  readonly entries = new Map<string, { state: ToolCallLedgerState; result?: ToolSuccessResult }>();
  async claim(key: string) {
    const entry = this.entries.get(key);
    if (entry) return { claimed: false as const, ...entry };
    this.entries.set(key, { state: "PENDING" });
    return { claimed: true as const };
  }
  async complete(key: string, result: ToolSuccessResult) {
    this.entries.set(key, { state: "SUCCEEDED", result });
  }
  async fail(key: string, outcomeKnown: boolean) {
    this.entries.set(key, { state: outcomeKnown ? "FAILED_KNOWN" : "OUTCOME_UNKNOWN" });
  }
}

const policy: ExecutionPolicy = {
  version: 1,
  allowedTools: ["counter.write"],
  deniedTools: [],
  approvalTools: [],
  allowedHosts: [],
  workspaceRoots: [],
  toolDisclosure: "index",
  skillDisclosure: "catalog",
};

function request(tool: ReturnType<ToolRegistry["resolve"]>, argumentsValue: unknown) {
  return {
    runId: "run-1",
    roomId: "room-1",
    toolCallId: "call-1",
    toolId: tool.id,
    toolVersion: tool.version,
    expectedSchemaDigest: tool.schemaDigest,
    arguments: argumentsValue,
    policy,
    skillAllowedTools: new Set([tool.id]),
    agentCapabilities: new Set(["counter:write"]),
    remainingToolCalls: 2,
    remainingWallTimeMs: 10_000,
    checkMemberPermission: () => true,
    checkArgumentBoundary: () => true,
  };
}

function setup(idempotency: "KEYED" | "NON_IDEMPOTENT" = "KEYED") {
  const execute = vi.fn(async ({ value }: { value: number }) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { value };
  });
  const registry = new ToolRegistry();
  const tool = registry.register({
    id: "counter.write", version: "1.0.0", description: "counter", category: "action",
    inputSchema: z.strictObject({ value: z.number() }), inputSchemaDocument: { type: "object" },
    risk: "WRITE", idempotency, timeoutMs: 1_000, maxResultBytes: 1_000,
    requiredCapabilities: ["counter:write"], execute,
  });
  const ledger = new MemoryLedger();
  const artifacts = { put: vi.fn() };
  return { execute, tool, ledger, executor: new ToolExecutor(registry, ledger, artifacts) };
}

describe("ToolExecutor", () => {
  it("coalesces concurrent calls with the same key and shares the result", async () => {
    const { executor, execute, tool } = setup();
    const [first, second] = await Promise.all([
      executor.execute(request(tool, { value: 1 })),
      executor.execute(request(tool, { value: 1 })),
    ]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ status: "SUCCEEDED", result: { value: 1 } });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("uses a new digest and executes when arguments change", async () => {
    const { executor, execute, tool, ledger } = setup();
    await executor.execute(request(tool, { value: 1 }));
    await executor.execute(request(tool, { value: 2 }));
    expect(execute).toHaveBeenCalledTimes(2);
    expect(new Set(ledger.entries.keys()).size).toBe(2);
  });

  it("blocks a non-idempotent call whose previous outcome is unknown", async () => {
    const { executor, execute, tool, ledger } = setup("NON_IDEMPOTENT");
    const input = request(tool, { value: 1 });
    execute.mockRejectedValueOnce(new Error("connection_lost"));
    await expect(executor.execute(input)).rejects.toThrow("connection_lost");
    expect([...ledger.entries.values()][0]).toMatchObject({ state: "OUTCOME_UNKNOWN" });
    const blocked = await executor.execute(input);
    expect(blocked).toMatchObject({ status: "BLOCKED", reason: "non_idempotent_outcome_unknown" });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
