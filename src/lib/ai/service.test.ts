import { AiRunMode, AiRunStatus, AgentKind, MessageKind, ModelProviderType, PrincipalType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
  aiRun: { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  agentRunEvent: { findFirst: vi.fn(), create: vi.fn() },
  artifact: { upsert: vi.fn() },
  message: { create: vi.fn(), findMany: vi.fn() },
  outboxEvent: { create: vi.fn() },
  room: { update: vi.fn() },
  roomMember: { findFirst: vi.fn(), findMany: vi.fn() },
  agent: { findFirst: vi.fn(), findMany: vi.fn() },
};
const callChatProvider = vi.fn();
const generateImage = vi.fn();
const publishAgentEvent = vi.fn();
const publishMessage = vi.fn();

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/ai/providers", () => ({ callChatProvider, generateImage }));
vi.mock("@/lib/ai/secrets", () => ({ decryptSecret: vi.fn(() => "secret") }));
vi.mock("@/lib/chat/events", () => ({ publishAgentEvent, publishMessage }));
vi.mock("@/lib/ai/artifact-storage", () => ({
  createArtifactStorage: () => ({ put: vi.fn(), delete: vi.fn() }),
}));

const model = {
  enabled: true,
  baseUrl: "https://provider.example/v1",
  modelId: "chat-model",
  timeoutMs: 30_000,
  ciphertext: null,
  secretRef: null,
  providerType: ModelProviderType.OPENAI_COMPATIBLE,
};

function directRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    roomId: "room-1",
    triggerMessageId: "message-1",
    callerMemberId: "caller-1",
    targetAgentId: "agent-1",
    targetMemberId: "assistant-1",
    membershipVersion: 3,
    leaseGeneration: 1,
    owner: "owner-1",
    attempt: 1,
    mode: AiRunMode.DIRECT,
    status: AiRunStatus.CLAIMED,
    updatedAt: new Date(),
    triggerMessage: { id: "message-1", body: "hello", contentParts: [] },
    callerMember: { id: "caller-1", roomId: "room-1", leftAt: null },
    targetMember: { id: "assistant-1", roomId: "room-1", version: 3, leftAt: null },
    targetAgent: { id: "agent-1", key: "chat", name: "Chat", enabled: true, kind: AgentKind.CHAT, systemPrompt: "system", model },
    room: { supervisor: null },
    ...overrides,
  };
}

function arrangeClaim(run: ReturnType<typeof directRun>) {
  db.aiRun.findUnique
    .mockResolvedValueOnce({ roomId: run.roomId, mode: run.mode, targetAgentId: run.targetAgentId, runtimeKind: null })
    .mockResolvedValueOnce(run)
    .mockResolvedValueOnce({ ...run, status: AiRunStatus.RUNNING });
  db.aiRun.count.mockResolvedValue(0);
  db.aiRun.updateMany
    .mockResolvedValueOnce({ count: 1 })
    .mockResolvedValueOnce({ count: 1 });
}

describe("AI run service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.$transaction.mockImplementation(async (callback: (tx: typeof db) => unknown) => callback(db));
    db.$executeRaw.mockResolvedValue(0);
    db.agentRunEvent.findFirst.mockResolvedValue(null);
    db.agentRunEvent.create.mockResolvedValue({});
  });

  it("claims and completes a direct text run exactly once", async () => {
    const run = directRun();
    arrangeClaim(run);
    db.aiRun.findUnique.mockResolvedValueOnce({ ...run, status: AiRunStatus.SUCCEEDED });
    db.aiRun.findUnique.mockResolvedValueOnce({ responseMessage: null });
    db.message.findMany.mockResolvedValue([{ body: "hello", kind: MessageKind.TEXT, senderMember: { principalType: PrincipalType.USER } }]);
    callChatProvider.mockResolvedValue({ content: "answer", tokenUsage: 23 });
    db.roomMember.findFirst.mockResolvedValue(run.targetMember);
    db.aiRun.updateMany.mockResolvedValueOnce({ count: 1 });
    db.room.update.mockResolvedValue({ lastSequence: 7 });
    db.message.create.mockResolvedValue({ id: "response-1" });
    db.aiRun.update.mockResolvedValue({});
    db.outboxEvent.create.mockResolvedValue({});
    const { processAiRun } = await import("./service");

    await processAiRun(run.id);

    expect(callChatProvider).toHaveBeenCalledOnce();
    expect(db.message.create).toHaveBeenCalledOnce();
    expect(db.aiRun.update).toHaveBeenCalledWith({ where: { id: run.id }, data: { responseMessageId: "response-1" } });
    expect(publishMessage).toHaveBeenCalledWith(run.roomId, "response-1");
  });

  it("does nothing when another worker owns the run", async () => {
    db.aiRun.findUnique.mockResolvedValue({ roomId: "room-1", mode: AiRunMode.DIRECT, targetAgentId: "agent-1", runtimeKind: null });
    db.aiRun.count.mockResolvedValue(0);
    db.aiRun.updateMany.mockResolvedValue({ count: 0 });
    const { processAiRun } = await import("./service");

    await processAiRun("run-1");

    expect(callChatProvider).not.toHaveBeenCalled();
    expect(db.message.create).not.toHaveBeenCalled();
  });

  it("does not claim runs assigned to a different runtime", async () => {
    db.aiRun.findUnique.mockResolvedValue({ roomId: "room-1", mode: AiRunMode.DIRECT, targetAgentId: "agent-1", runtimeKind: "self_hosted" });
    const { processAiRun } = await import("./service");

    await processAiRun("run-1");

    expect(db.aiRun.updateMany).not.toHaveBeenCalled();
    expect(callChatProvider).not.toHaveBeenCalled();
  });

  it("marks a revoked caller as cancelled without calling the provider", async () => {
    const run = directRun({ callerMember: { id: "caller-1", roomId: "room-1", leftAt: new Date() } });
    arrangeClaim(run);
    db.aiRun.updateMany.mockResolvedValueOnce({ count: 1 });
    db.outboxEvent.create.mockResolvedValue({});
    const { processAiRun } = await import("./service");

    await expect(processAiRun(run.id)).rejects.toThrow("caller_membership_revoked");

    expect(callChatProvider).not.toHaveBeenCalled();
    expect(db.aiRun.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: AiRunStatus.CANCELLED, errorCode: "caller_membership_revoked" }),
    }));
  });

  it("moves a transient provider failure to retryable", async () => {
    const run = directRun();
    arrangeClaim(run);
    db.message.findMany.mockResolvedValue([]);
    callChatProvider.mockRejectedValue(new Error("provider_http_429"));
    db.aiRun.updateMany.mockResolvedValueOnce({ count: 1 });
    const { processAiRun } = await import("./service");

    await expect(processAiRun(run.id)).rejects.toThrow("provider_http_429");

    expect(db.aiRun.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: AiRunStatus.FAILED_RETRYABLE, errorCode: "provider_http_429" }),
    }));
    expect(db.message.create).not.toHaveBeenCalled();
  });

  it("recovers pending, retryable, and expired leased runs", async () => {
    db.aiRun.findMany.mockResolvedValue([]);
    const { recoverPendingAiRuns } = await import("./service");

    await expect(recoverPendingAiRuns(7)).resolves.toBe(0);

    expect(db.aiRun.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 7 }));
    const where = db.aiRun.findMany.mock.calls[0][0].where;
    expect(where.OR).toHaveLength(3);
  });
});
