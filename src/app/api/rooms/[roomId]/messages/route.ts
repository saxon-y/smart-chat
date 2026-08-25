import { getCurrentUser } from "@/lib/auth/session";
import { activeMembership, createMessage, loadAgentNames, publicMessage } from "@/lib/chat";
import { validateAttachments } from "@/lib/chat/validation";
import { db } from "@/lib/db";
import { errorResponse, getRequestId, json } from "@/lib/http";
import { triggerAiRun } from "@/lib/chat/ai-trigger";
export const runtime = "nodejs";
async function auth(roomId: string) { const user = await getCurrentUser(); if (!user) return { error: errorResponse("需要先登录", 401, "UNAUTHENTICATED") }; const member = await activeMembership(roomId, user.id); if (!member) return { error: errorResponse("需要先加入该房间", 403, "FORBIDDEN") }; return { user, member }; }
export async function GET(request: Request, context: { params: Promise<{ roomId: string }> }) {
  const roomId = (await context.params).roomId; const result = await auth(roomId); if (result.error) return result.error;
  const url = new URL(request.url); const after = Number(url.searchParams.get("after") || 0); const requestedLimit = Number(url.searchParams.get("limit") || 100); const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 200)) : 100;
  const [messages, agentNames] = await Promise.all([
    db.message.findMany({ where: { roomId, deletedAt: null, ...(Number.isFinite(after) && after > 0 ? { roomSequence: { gt: after } } : {}) }, orderBy: { roomSequence: "asc" }, take: limit, include: { senderMember: { include: { user: { select: { displayName: true } } } }, mentions: true } }),
    loadAgentNames(),
  ]);
  return json({ messages: messages.map((m) => publicMessage(m, agentNames)), nextSequence: messages.at(-1)?.roomSequence ?? after });
}
export async function POST(request: Request, context: { params: Promise<{ roomId: string }> }) {
  const roomId = (await context.params).roomId; const result = await auth(roomId); if (result.error) return result.error;
  const payload = await request.json().catch(() => null) as { body?: unknown; text?: unknown; clientId?: unknown; mentions?: unknown; attachments?: unknown } | null;
  const body = payload?.body ?? payload?.text ?? ""; const clientId = typeof payload?.clientId === "string" && payload.clientId.length <= 100 ? payload.clientId : undefined;
  const checkedAttachments = validateAttachments(payload?.attachments);
  if (!checkedAttachments.ok) return errorResponse(checkedAttachments.message, 400, "VALIDATION_ERROR");
  try {
    const created = await createMessage({ roomId, memberId: result.member.id, body: body as string, attachments: checkedAttachments.attachments, clientId, mentions: Array.isArray(payload?.mentions) ? payload.mentions : [], requestId: getRequestId(request) });
    if (created.aiRun && !created.duplicate) void triggerAiRun(created.aiRun.id).catch(() => undefined);
    const agentNames = await loadAgentNames();
    return json({ message: publicMessage(created.message, agentNames), duplicate: created.duplicate, aiRunId: created.aiRun?.id ?? null }, { status: created.duplicate ? 200 : 201 });
  } catch (error) { return errorResponse(error instanceof Error ? error.message : "无法发送消息", 400, "VALIDATION_ERROR"); }
}
