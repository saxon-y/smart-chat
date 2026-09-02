import { describe, expect, it, vi } from "vitest";
import { sha256Digest } from "../protocol";
import { buildAndCommitTaskEnvelope, buildTaskEnvelope, type TaskEnvelopeBuildInput } from "./task-builder";

const digest = "a".repeat(64);

function validInput(): TaskEnvelopeBuildInput {
  return {
    protocolVersion: "smart-chat-harness/v1",
    runId: "run-1",
    roomId: "room-1",
    triggerMessageId: "message-1",
    objective: "answer the user",
    agent: { id: "agent-1", prompt: "Be concise" },
    runtime: {
      id: "embedded",
      kind: "EMBEDDED",
      adapter: "openai-compatible",
      adapterVersion: "1",
      requiredCapabilities: ["text"],
    },
    contextBundle: {
      generation: 1,
      objective: "answer the user",
      blocks: [],
      referencedArtifacts: [],
      decisions: [],
      unresolved: [],
      digest,
    },
    skillBundle: { version: 1, skills: [], bundleHash: digest },
    mcpBundle: { revision: 0, tools: [], digest },
    policy: {
      version: 1,
      allowedTools: [],
      deniedTools: [],
      approvalTools: [],
      allowedHosts: [],
      workspaceRoots: [],
      toolDisclosure: "index",
      skillDisclosure: "catalog",
    },
    limits: {
      maxTurns: 12,
      maxInputTokens: 10_000,
      maxOutputTokens: 2_000,
      maxToolCalls: 32,
      maxWallTimeMs: 900_000,
    },
    outputContract: { format: "TEXT" },
  };
}

describe("buildTaskEnvelope", () => {
  it("recomputes bundle digests and a deterministic task digest", () => {
    const first = buildTaskEnvelope(validInput());
    const reordered = validInput();
    reordered.agent = { prompt: "Be concise", id: "agent-1" };
    reordered.contextBundle.digest = "b".repeat(64);

    const second = buildTaskEnvelope(reordered);

    expect(first).toEqual(second);
    expect(first.envelope.contextBundle.digest).toBe(sha256Digest({
      generation: 1,
      objective: "answer the user",
      blocks: [],
      referencedArtifacts: [],
      decisions: [],
      unresolved: [],
    }));
    expect(first.envelope.skillBundle.bundleHash).toBe(first.bundleDigests.skills);
    expect(first.envelope.mcpBundle.digest).toBe(first.bundleDigests.mcp);
    expect(first.taskDigest).toBe(sha256Digest(first.envelope));
  });

  it("returns a detached, deeply frozen snapshot", () => {
    const input = validInput();
    const built = buildTaskEnvelope(input);
    (input.agent as Record<string, unknown>).prompt = "Changed later";
    input.runtime.requiredCapabilities.push("tools");

    expect(built.envelope.agent.prompt).toBe("Be concise");
    expect(built.envelope.runtime.requiredCapabilities).toEqual(["text"]);
    expect(Object.isFrozen(built)).toBe(true);
    expect(Object.isFrozen(built.envelope.agent)).toBe(true);
    expect(Object.isFrozen(built.envelope.runtime.requiredCapabilities)).toBe(true);
  });

  it("rejects credential fields anywhere in the snapshot", () => {
    const input = validInput();
    input.agent = { id: "agent-1", credentials: { accessToken: "plaintext" } };

    expect(() => buildTaskEnvelope(input)).toThrow(
      "task_envelope_forbidden_secret_field:task.agent.credentials.accessToken",
    );
  });

  it("only calls the READY transaction boundary after successful validation", async () => {
    const commitReady = vi.fn();
    const built = await buildAndCommitTaskEnvelope(validInput(), commitReady);
    expect(commitReady).toHaveBeenCalledOnce();
    expect(commitReady).toHaveBeenCalledWith(built);

    const invalid = validInput();
    invalid.objective = "";
    await expect(buildAndCommitTaskEnvelope(invalid, commitReady)).rejects.toThrow();
    expect(commitReady).toHaveBeenCalledOnce();
  });
});
