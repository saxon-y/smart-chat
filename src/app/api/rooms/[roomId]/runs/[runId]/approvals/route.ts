import { getCurrentUser } from "@/lib/auth/session";
import { activeMembership } from "@/lib/chat";
import { db } from "@/lib/db";
import { errorResponse, json } from "@/lib/http";
import { presentApproval } from "@/lib/harness/approvals/presentation";
export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ roomId: string; runId: string }> }) {
  const user = await getCurrentUser(); if (!user) return errorResponse("需要先登录", 401, "UNAUTHENTICATED");
  const { roomId, runId } = await context.params; if (!await activeMembership(roomId, user.id)) return errorResponse("需要先加入该房间", 403, "FORBIDDEN");
  const approvals = await db.agentApproval.findMany({ where: { runId, run: { roomId } }, orderBy: { requestedAt: "asc" }, select: { id: true, runId: true, status: true, requestedAt: true, decidedAt: true, decisionReason: true, toolCall: { select: { toolId: true, risk: true } } } });
  return json({ approvals: approvals.map((approval) => ({ id: approval.id, runId: approval.runId, status: approval.status, toolId: approval.toolCall.toolId, risk: approval.toolCall.risk, requestedAt: approval.requestedAt, decidedAt: approval.decidedAt, decisionReason: approval.decisionReason, ...presentApproval({ toolId: approval.toolCall.toolId, risk: approval.toolCall.risk, status: approval.status }) })) });
}
