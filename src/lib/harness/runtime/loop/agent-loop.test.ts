import { describe, expect, it, vi } from "vitest";
import { sha256Digest, taskEnvelopeSchema, type TaskEnvelope } from "../../protocol";
import type { ModelEvent, ModelProvider, ModelRequest } from "../providers";
import { AgentLoop } from "./agent-loop";
import type { AgentLoopPorts, LoopSnapshot } from "./types";

function task(limits: Partial<TaskEnvelope["limits"]> = {}) {
  return taskEnvelopeSchema.parse({
    protocolVersion: "smart-chat-harness/v1", runId: "run-1", roomId: "room-1", triggerMessageId: "message-1", objective: "answer",
    agent: {}, runtime: { id: "embedded", kind: "EMBEDDED", adapter: "test", adapterVersion: "1", requiredCapabilities: [] },
    contextBundle: { generation: 0, objective: "answer", blocks: [], referencedArtifacts: [], decisions: [], unresolved: [], digest: "a".repeat(64) },
    skillBundle: { version: 1, skills: [], bundleHash: "b".repeat(64) }, mcpBundle: { revision: 0, tools: [], digest: "c".repeat(64) },
    policy: { version: 1, allowedTools: ["lookup"], deniedTools: [], approvalTools: [], allowedHosts: [], workspaceRoots: [] },
    limits: { maxTurns: 4, maxInputTokens: 100, maxOutputTokens: 100, maxToolCalls: 4, maxWallTimeMs: 10_000, ...limits },
    outputContract: { format: "TEXT" },
  });
}

function provider(turns: ModelEvent[][]): ModelProvider {
  let index = 0;
  return { async *generate() { yield* (turns[index++] ?? []); } };
}

function complete(text: string, toolCalls: Array<{ id: string; name: string; arguments: unknown }> = [], finishReason = "stop"): ModelEvent[] {
  return [
    { type: "text.delta", text },
    { type: "response.completed", response: { content: [{ type: "text", text }], toolCalls, finishReason }, usage: { inputTokens: 2, outputTokens: 1 } },
  ];
}

function ports(model: ModelProvider, overrides: Partial<AgentLoopPorts> = {}) {
  const request: ModelRequest = { model: "test", messages: [{ role: "user", content: "answer" }] };
  const snapshot = (taskValue: TaskEnvelope): LoopSnapshot => ({ task: taskValue, turnCount: 0, toolCallCount: 0, usage: { inputTokens: 0, outputTokens: 0 } });
  const value: AgentLoopPorts = {
    provider: model,
    load: vi.fn(async (taskValue) => snapshot(taskValue)),
    buildInput: vi.fn(async () => ({ request, inputDigest: sha256Digest(request) })),
    commitTurn: vi.fn(async () => undefined),
    authorize: vi.fn(async () => ({ decision: "ALLOW" as const })),
    executeTool: vi.fn(async (tool) => ({ callId: tool.callId, toolId: tool.name, ok: true, output: { found: true } })),
    appendToolResult: vi.fn(async () => undefined), checkpoint: vi.fn(async () => undefined), finalize: vi.fn(async () => undefined),
    ...overrides,
  };
  return value;
}

describe("AgentLoop", () => {
  it("completes a no-tool response and commits exactly one full turn", async () => {
    const harness = ports(provider([complete("hello")]));
    const outcome = await new AgentLoop(harness).run(task(), new AbortController().signal);
    expect(outcome.result).toMatchObject({ status: "COMPLETED", summary: "hello" });
    expect(harness.commitTurn).toHaveBeenCalledOnce();
    expect(harness.checkpoint).toHaveBeenCalledOnce();
  });

  it("executes a tool and feeds its result into a subsequent model turn", async () => {
    const harness = ports(provider([
      complete("", [{ id: "call-1", name: "lookup", arguments: { query: "x" } }], "tool_calls"),
      complete("found"),
    ]));
    const outcome = await new AgentLoop(harness).run(task(), new AbortController().signal);
    expect(outcome.result.status).toBe("COMPLETED");
    expect(harness.commitTurn).toHaveBeenCalledTimes(2);
    expect(harness.executeTool).toHaveBeenCalledOnce();
    expect(harness.appendToolResult).toHaveBeenCalledOnce();
    expect(outcome.snapshot).toMatchObject({ turnCount: 2, toolCallCount: 1 });
  });

  it("stops before tool execution when its hard budget is exhausted", async () => {
    const harness = ports(provider([complete("", [{ id: "1", name: "lookup", arguments: {} }], "tool_calls")]));
    const outcome = await new AgentLoop(harness).run(task({ maxToolCalls: 0 }), new AbortController().signal);
    expect(outcome.result).toMatchObject({ status: "FAILED", summary: "tool_call_limit_exceeded" });
    expect(harness.executeTool).not.toHaveBeenCalled();
  });

  it("does not commit a partial response when cancelled during streaming", async () => {
    const controller = new AbortController();
    const model: ModelProvider = { async *generate() { yield { type: "text.delta", text: "half" }; controller.abort(); } };
    const harness = ports(model);
    const outcome = await new AgentLoop(harness).run(task(), controller.signal);
    expect(outcome.result.status).toBe("CANCELLED");
    expect(harness.commitTurn).not.toHaveBeenCalled();
  });

  it("fails an incomplete provider stream without committing a turn", async () => {
    const harness = ports(provider([[{ type: "text.delta", text: "half" }]]));
    const outcome = await new AgentLoop(harness).run(task(), new AbortController().signal);
    expect(outcome.result).toMatchObject({ status: "FAILED", summary: "model_response_incomplete" });
    expect(harness.commitTurn).not.toHaveBeenCalled();
  });

  it("guards against a provider-driven infinite tool loop", async () => {
    const toolTurn = complete("", [{ id: "repeat", name: "lookup", arguments: {} }], "tool_calls");
    const endless: ModelProvider = { async *generate() { yield* toolTurn; } };
    const harness = ports(endless);
    const outcome = await new AgentLoop(harness, { maxStateTransitions: 12 }).run(task({ maxTurns: 100, maxToolCalls: 100 }), new AbortController().signal);
    expect(outcome.result).toMatchObject({ status: "FAILED", summary: "agent_loop_transition_limit_exceeded" });
    expect(harness.finalize).toHaveBeenCalledOnce();
  });

  it("maps a model length finish to a deterministic failure", async () => {
    const harness = ports(provider([complete("truncated", [], "length")]));
    const outcome = await new AgentLoop(harness).run(task(), new AbortController().signal);
    expect(outcome.result).toMatchObject({ status: "FAILED", summary: "model_length_limit" });
  });

  it("persists a known tool failure and then stops", async () => {
    const harness = ports(
      provider([complete("", [{ id: "1", name: "lookup", arguments: {} }], "tool_calls")]),
      { executeTool: vi.fn(async () => ({ callId: "1", toolId: "lookup", ok: false, output: { code: "not_found" } })) },
    );
    const outcome = await new AgentLoop(harness).run(task(), new AbortController().signal);
    expect(outcome.result).toMatchObject({ status: "FAILED", summary: "tool_failed:lookup" });
    expect(harness.appendToolResult).toHaveBeenCalledOnce();
    expect(harness.checkpoint).toHaveBeenCalledOnce();
  });
});
