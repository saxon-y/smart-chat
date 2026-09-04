import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { activeMembership } from "@/lib/chat";
import { db } from "@/lib/db";
import { errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";
const schema = z.strictObject({ resultRunId: z.string().min(1).max(100).nullable() });

export async function POST(request: Request, context: { params: Promise<{ roomId: string; runId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return errorResponse("需要先登录", 401, "UNAUTHENTICATED");
  const { roomId, runId } = await context.params;
  if (!await activeMembership(roomId, user.id)) return errorResponse("需要先加入该房间", 403, "FORBIDDEN");
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return errorResponse("采用结果参数无效", 400, "INVALID_ADOPTION");
  const parent = await db.aiRun.findFirst({ where: { id: runId, roomId }, select: { id: true, childRuns: { select: { id: true } } } });
  if (!parent) return errorResponse("运行记录不存在", 404, "NOT_FOUND");
  if (body.data.resultRunId && !parent.childRuns.some((child) => child.id === body.data.resultRunId)) return errorResponse("结果不属于该汇总任务", 409, "INVALID_RESULT_SOURCE");
  const action = body.data.resultRunId ? "agent.result.adopt" : "agent.result.adoption.revoke";
  await db.auditLog.create({ data: { actorId: user.id, action, targetType: "AiRun", targetId: runId, after: { resultRunId: body.data.resultRunId, source: "user_selection" } } });
  return json({ runId, resultRunId: body.data.resultRunId, adopted: Boolean(body.data.resultRunId) });
}

export async function GET(_request: Request, context: { params: Promise<{ roomId: string; runId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return errorResponse("需要先登录", 401, "UNAUTHENTICATED");
  const { roomId, runId } = await context.params;
  if (!await activeMembership(roomId, user.id)) return errorResponse("需要先加入该房间", 403, "FORBIDDEN");
  const latest = await db.auditLog.findFirst({ where: { targetType: "AiRun", targetId: runId, action: { in: ["agent.result.adopt", "agent.result.adoption.revoke"] } }, orderBy: { createdAt: "desc" }, select: { action: true, after: true, createdAt: true } });
  const resultRunId = latest?.after && typeof latest.after === "object" && !Array.isArray(latest.after) && "resultRunId" in latest.after && typeof latest.after.resultRunId === "string" ? latest.after.resultRunId : null;
  return json({ runId, resultRunId, adopted: latest?.action === "agent.result.adopt", updatedAt: latest?.createdAt ?? null });
}
