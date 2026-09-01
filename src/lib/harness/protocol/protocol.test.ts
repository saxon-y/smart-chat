import { describe, expect, it } from "vitest";
import { canonicalJson, classifyRuntimeError, sha256Digest, taskEnvelopeSchema } from ".";

const digest = "a".repeat(64);

function validTask() {
  return {
    protocolVersion: "smart-chat-harness/v1",
    runId: "run-1",
    roomId: "room-1",
    triggerMessageId: "message-1",
    objective: "answer the user",
    agent: { id: "agent-1", version: 1 },
    runtime: { id: "embedded", kind: "EMBEDDED", adapter: "openai-compatible", adapterVersion: "1", requiredCapabilities: ["text"] },
    contextBundle: { generation: 1, objective: "answer the user", blocks: [], referencedArtifacts: [], decisions: [], unresolved: [], digest },
    skillBundle: { version: 1, skills: [], bundleHash: digest },
    mcpBundle: { revision: 0, tools: [], digest },
    policy: { version: 1, allowedTools: [], deniedTools: [], approvalTools: [], allowedHosts: [], workspaceRoots: [] },
    limits: { maxTurns: 12, maxInputTokens: 10_000, maxOutputTokens: 2_000, maxToolCalls: 32, maxWallTimeMs: 900_000 },
    outputContract: { format: "TEXT" },
  };
}

describe("harness protocol", () => {
  it("produces stable canonical JSON and digests regardless of object key order", () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}');
    expect(sha256Digest({ b: 2, a: 1 })).toBe(sha256Digest({ a: 1, b: 2 }));
  });

  it("parses a complete v1 envelope and applies safe disclosure defaults", () => {
    const parsed = taskEnvelopeSchema.parse(validTask());
    expect(parsed.policy.toolDisclosure).toBe("index");
    expect(parsed.policy.skillDisclosure).toBe("catalog");
  });

  it("rejects unknown top-level fields and nested secret fields", () => {
    expect(() => taskEnvelopeSchema.parse({ ...validTask(), extra: true })).toThrow();
    expect(() => taskEnvelopeSchema.parse({ ...validTask(), agent: { id: "agent-1", nested: { apiKey: "secret" } } })).toThrow("task_envelope_forbidden_secret_field");
    expect(() => taskEnvelopeSchema.parse({ ...validTask(), runtime: { ...validTask().runtime, token: "secret" } })).toThrow();
  });

  it("rejects invalid versions, incomplete limits, and invalid digests", () => {
    expect(() => taskEnvelopeSchema.parse({ ...validTask(), protocolVersion: "v2" })).toThrow();
    expect(() => taskEnvelopeSchema.parse({ ...validTask(), limits: { maxTurns: 1 } })).toThrow();
    expect(() => taskEnvelopeSchema.parse({ ...validTask(), contextBundle: { ...validTask().contextBundle, digest: "bad" } })).toThrow();
  });
});

describe("runtime error classification", () => {
  it("only retries explicit transient provider errors", () => {
    expect(classifyRuntimeError(new Error("provider_http_429"))).toMatchObject({ category: "PROVIDER", retryable: true, outcomeKnown: true });
    expect(classifyRuntimeError(new Error("provider_http_400"))).toMatchObject({ category: "PROVIDER", retryable: false });
    expect(classifyRuntimeError(new Error("provider_outcome_unknown"))).toMatchObject({ retryable: false, outcomeKnown: false, continuity: "REBUILT" });
  });

  it("fails closed and never exposes an unknown error message", () => {
    const classified = classifyRuntimeError(new Error("Database password is secret"));
    expect(classified.code).toBe("runtime_unknown_error");
    expect(classified.publicMessage).toBe("Agent 执行失败");
  });

  it("blocks tool calls whose external outcome is unknown", () => {
    expect(classifyRuntimeError(new Error("tool_outcome_unknown"))).toMatchObject({
      category: "TOOL", retryable: false, outcomeKnown: false, continuity: "GAP",
    });
  });
});
