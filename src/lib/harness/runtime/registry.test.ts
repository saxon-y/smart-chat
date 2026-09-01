import { describe, expect, it, vi } from "vitest";
import { taskEnvelopeSchema, type RunResult } from "../protocol";
import { RuntimeRegistry, type AgentRuntime } from ".";

function runtime(id: string, capabilities = ["text"]): AgentRuntime {
  const result: RunResult = { status: "COMPLETED", output: [], summary: "", artifacts: [], decisions: [], followups: [], usage: { inputTokens: 0, outputTokens: 0 }, continuity: "FULL" };
  return {
    id,
    capabilities: vi.fn().mockResolvedValue({ tools: false, streaming: true, resume: false, modalities: ["text"], capabilities }),
    execute: vi.fn().mockResolvedValue({ events: (async function* () {})(), result: Promise.resolve(result) }),
    resume: vi.fn(),
    cancel: vi.fn(),
  };
}

const digest = "a".repeat(64);
const task = taskEnvelopeSchema.parse({
  protocolVersion: "smart-chat-harness/v1", runId: "run-1", roomId: "room-1", triggerMessageId: "message-1", objective: "test",
  agent: {}, runtime: { id: "embedded", kind: "EMBEDDED", adapter: "test", adapterVersion: "1", requiredCapabilities: ["text"] },
  contextBundle: { generation: 1, objective: "test", blocks: [], referencedArtifacts: [], decisions: [], unresolved: [], digest },
  skillBundle: { version: 1, skills: [], bundleHash: digest }, mcpBundle: { revision: 0, tools: [], digest },
  policy: { version: 1, allowedTools: [], deniedTools: [], approvalTools: [], allowedHosts: [], workspaceRoots: [] },
  limits: { maxTurns: 1, maxInputTokens: 1, maxOutputTokens: 1, maxToolCalls: 0, maxWallTimeMs: 1 }, outputContract: { format: "TEXT" },
});

describe("RuntimeRegistry", () => {
  it("resolves a registered runtime with all required capabilities", async () => {
    const registry = new RuntimeRegistry();
    const adapter = runtime("embedded");
    registry.register(adapter);
    await expect(registry.resolve(task)).resolves.toBe(adapter);
  });

  it("rejects duplicate registrations, missing runtimes, and capability mismatches", async () => {
    const registry = new RuntimeRegistry();
    registry.register(runtime("embedded", []));
    expect(() => registry.register(runtime("embedded"))).toThrow("runtime_already_registered");
    await expect(registry.resolve(task)).rejects.toMatchObject({ code: "runtime_capability_mismatch" });
    expect(() => registry.get("missing")).toThrow("runtime_not_found");
  });
});
