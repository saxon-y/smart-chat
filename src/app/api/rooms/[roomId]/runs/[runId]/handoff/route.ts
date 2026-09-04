import { getCurrentUser } from "@/lib/auth/session";
import { activeMembership } from "@/lib/chat";
import { db } from "@/lib/db";
import { errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ roomId: string; runId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return errorResponse("需要先登录", 401, "UNAUTHENTICATED");
  const { roomId, runId } = await context.params;
  if (!await activeMembership(roomId, user.id)) return errorResponse("需要先加入该房间", 403, "FORBIDDEN");
  const run = await db.aiRun.findFirst({ where: { id: runId, roomId }, select: { id: true, status: true, childRuns: { orderBy: { createdAt: "asc" }, select: { id: true, status: true, errorCode: true, createdAt: true, targetAgent: { select: { name: true, model: { select: { name: true } } } } } } } });
  if (!run) return errorResponse("运行记录不存在", 404, "NOT_FOUND");
  return json({ parentRunId: run.id, status: run.status, sources: run.childRuns.map((child) => ({ runId: child.id, agentName: child.targetAgent?.name ?? "Agent", modelName: child.targetAgent?.model?.name ?? null, status: child.status, available: child.status === "SUCCEEDED", error: child.status === "SUCCEEDED" ? undefined : "该 Agent 未能提供结果", createdAt: child.createdAt })) });
}
