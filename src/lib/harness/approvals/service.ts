import { AiRunStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications";

export type ApprovalDecision = "APPROVED" | "REJECTED";

export async function decideAgentApproval(input: {
  approvalId: string;
  runId: string;
  roomId: string;
  userId: string;
  isAdmin: boolean;
  decision: ApprovalDecision;
  reason?: string;
}) {
  return db.$transaction(async (tx) => {
    const approval = await tx.agentApproval.findFirst({
      where: { id: input.approvalId, runId: input.runId, run: { roomId: input.roomId } },
      include: { toolCall: { select: { risk: true, argumentsDigest: true } } },
    });
    if (!approval) return { kind: "NOT_FOUND" as const };
    const membership = await tx.roomMember.findFirst({ where: { roomId: input.roomId, userId: input.userId, leftAt: null } });
    if (!membership) return { kind: "FORBIDDEN" as const };
    const privileged = input.isAdmin || membership.roomRole === "OWNER" || membership.roomRole === "MODERATOR";
    if (approval.toolCall.risk !== "READ" && !privileged) return { kind: "FORBIDDEN" as const };
    if (approval.argumentsDigest !== approval.toolCall.argumentsDigest) return { kind: "ARGUMENTS_CHANGED" as const };
    if (approval.status !== "PENDING") {
      return approval.status === input.decision ? { kind: "DECIDED" as const, approval } : { kind: "CONFLICT" as const };
    }
    const changed = await tx.agentApproval.updateMany({
      where: { id: approval.id, status: "PENDING", argumentsDigest: approval.toolCall.argumentsDigest },
      data: { status: input.decision, decidedAt: new Date(), decidedBy: input.userId, decisionReason: input.reason },
    });
    if (changed.count !== 1) return { kind: "CONFLICT" as const };
    const pending = await tx.agentApproval.count({ where: { runId: input.runId, status: "PENDING" } });
    if (pending === 0) {
      await tx.aiRun.updateMany({
        where: { id: input.runId, roomId: input.roomId, status: AiRunStatus.WAITING_APPROVAL },
        data: { status: AiRunStatus.READY, blockedReason: null, owner: null, leaseExpiresAt: null },
      });
    }
    const decided = await tx.agentApproval.findUniqueOrThrow({ where: { id: approval.id } });
    const run = await tx.aiRun.findUnique({ where: { id: input.runId }, select: { callerMember: { select: { userId: true } } } });
    if (run?.callerMember.userId && run.callerMember.userId !== input.userId) {
      await createNotification({ userId: run.callerMember.userId, roomId: input.roomId, type: "APPROVAL", title: input.decision === "APPROVED" ? "审批已通过" : "审批已拒绝", summary: input.reason?.trim() || "审批状态已更新。", sourceId: approval.id, sourceType: "approval", dedupeKey: `approval:${approval.id}:${input.decision}` }, tx);
    }
    return { kind: "DECIDED" as const, approval: decided };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
