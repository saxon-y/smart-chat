import { AiRunStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = {
  agentApproval: { findFirst: vi.fn(), updateMany: vi.fn(), count: vi.fn(), findUniqueOrThrow: vi.fn() },
  roomMember: { findFirst: vi.fn() },
  aiRun: { updateMany: vi.fn() },
};
const db = { $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };
vi.mock("@/lib/db", () => ({ db }));

const pending = { id: "approval-1", runId: "run-1", status: "PENDING", argumentsDigest: "digest", toolCall: { risk: "WRITE", argumentsDigest: "digest" } };

describe("decideAgentApproval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.agentApproval.findFirst.mockResolvedValue(pending);
    tx.roomMember.findFirst.mockResolvedValue({ roomRole: "OWNER" });
    tx.agentApproval.updateMany.mockResolvedValue({ count: 1 });
    tx.agentApproval.count.mockResolvedValue(0);
    tx.agentApproval.findUniqueOrThrow.mockResolvedValue({ ...pending, status: "APPROVED" });
    tx.aiRun.updateMany.mockResolvedValue({ count: 1 });
  });

  it("atomically decides an approval and resumes a run with no pending approvals", async () => {
    const { decideAgentApproval } = await import("./service");
    const result = await decideAgentApproval({ approvalId: "approval-1", runId: "run-1", roomId: "room-1", userId: "user-1", isAdmin: false, decision: "APPROVED" });
    expect(result.kind).toBe("DECIDED");
    expect(tx.aiRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: AiRunStatus.WAITING_APPROVAL }), data: expect.objectContaining({ status: AiRunStatus.READY }) }));
  });

  it("denies write approvals from ordinary members", async () => {
    tx.roomMember.findFirst.mockResolvedValue({ roomRole: "MEMBER" });
    const { decideAgentApproval } = await import("./service");
    await expect(decideAgentApproval({ approvalId: "approval-1", runId: "run-1", roomId: "room-1", userId: "user-1", isAdmin: false, decision: "APPROVED" })).resolves.toEqual({ kind: "FORBIDDEN" });
    expect(tx.agentApproval.updateMany).not.toHaveBeenCalled();
  });

  it("requires a new approval when arguments changed", async () => {
    tx.agentApproval.findFirst.mockResolvedValue({ ...pending, toolCall: { ...pending.toolCall, argumentsDigest: "changed" } });
    const { decideAgentApproval } = await import("./service");
    await expect(decideAgentApproval({ approvalId: "approval-1", runId: "run-1", roomId: "room-1", userId: "user-1", isAdmin: true, decision: "APPROVED" })).resolves.toEqual({ kind: "ARGUMENTS_CHANGED" });
  });

  it("treats the same repeated decision as idempotent and rejects the opposite one", async () => {
    tx.agentApproval.findFirst.mockResolvedValue({ ...pending, status: "APPROVED" });
    const { decideAgentApproval } = await import("./service");
    await expect(decideAgentApproval({ approvalId: "approval-1", runId: "run-1", roomId: "room-1", userId: "user-1", isAdmin: true, decision: "APPROVED" })).resolves.toMatchObject({ kind: "DECIDED" });
    await expect(decideAgentApproval({ approvalId: "approval-1", runId: "run-1", roomId: "room-1", userId: "user-1", isAdmin: true, decision: "REJECTED" })).resolves.toEqual({ kind: "CONFLICT" });
  });
});
