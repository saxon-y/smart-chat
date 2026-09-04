import { getCurrentUser } from "@/lib/auth/session";
import { activeMembership, createMessage, loadAgentNames, publicMessage } from "@/lib/chat";
import { validateAttachments, validateArtifactAttachments } from "@/lib/chat/validation";
import { db } from "@/lib/db";
import { errorResponse, getRequestId, json } from "@/lib/http";
import { ensureAiWorker, triggerAiRun } from "@/lib/chat/ai-trigger";
import { getAiRunQuota } from "@/lib/ai/rate-limit";
import { z } from "zod";
import { roomPermission } from "@/lib/chat/rooms";
export const runtime = "nodejs";
async function auth(roomId: string) { const user = await getCurrentUser(); if (!user) return { error: errorResponse("需要先登录", 401, "UNAUTHENTICATED") }; const member = await activeMembership(roomId, user.id); if (!member) return { error: errorResponse("需要先加入该房间", 403, "FORBIDDEN") }; return { user, member }; }
export async function GET(request: Request, context: { params: Promise<{ roomId: string }> }) {
  const roomId = (await context.params).roomId; const result = await auth(roomId); if (result.error) return result.error;
  if (!(await roomPermission(result.user.id, roomId, "canView"))) return errorResponse("无权查看该房间", 403, "FORBIDDEN");
  const url = new URL(request.url); const after = Number(url.searchParams.get("after") || 0); const requestedLimit = Number(url.searchParams.get("limit") || 100); const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 200)) : 100;
  const [messages, agentNames] = await Promise.all([
    db.message.findMany({ where: { roomId, deletedAt: null, ...(Number.isFinite(after) && after > 0 ? { roomSequence: { gt: after } } : {}) }, orderBy: { roomSequence: "asc" }, take: limit, include: { senderMember: { include: { user: { select: { displayName: true } } } }, mentions: true, reactions: true, replyTo: { include: { senderMember: { include: { user: { select: { displayName: true } } } } } } } }),
    loadAgentNames(),
  ]);
  return json({ messages: messages.map((m) => publicMessage(m, agentNames)), nextSequence: messages.at(-1)?.roomSequence ?? after });
}
export async function POST(request: Request, context: { params: Promise<{ roomId: string }> }) {
  ensureAiWorker();
  const roomId = (await context.params).roomId; const result = await auth(roomId); if (result.error) return result.error;
  if (!(await roomPermission(result.user.id, roomId, "canPost"))) return errorResponse("该频道禁止发言", 403, "FORBIDDEN");
  const payload = await request.json().catch(() => null) as { body?: unknown; text?: unknown; clientId?: unknown; mentions?: unknown; attachments?: unknown; artifactAttachments?: unknown; metadata?: unknown; replyToId?: unknown } | null;
  const body = payload?.body ?? payload?.text ?? ""; const clientId = typeof payload?.clientId === "string" && payload.clientId.length <= 100 ? payload.clientId : undefined;
  const replyToId = payload?.replyToId === undefined || payload?.replyToId === null || payload?.replyToId === "" ? undefined : typeof payload.replyToId === "string" && payload.replyToId.length <= 100 ? payload.replyToId : null;
  if (replyToId === null) return errorResponse("引用消息 ID 不合法", 400, "VALIDATION_ERROR");
  const checkedAttachments = validateAttachments(payload?.attachments);
  if (!checkedAttachments.ok) return errorResponse(checkedAttachments.message, 400, "VALIDATION_ERROR");
  const checkedArtifacts = validateArtifactAttachments(payload?.artifactAttachments);
  if (!checkedArtifacts.ok) return errorResponse(checkedArtifacts.message, 400, "VALIDATION_ERROR");
  const metadata = z.object({ imagePrompt: z.object({ style: z.enum(["auto", "photorealistic", "comic", "illustration"]).default("auto"), size: z.enum(["1024x1024", "1536x1024", "1024x1536"]).default("1024x1024"), aspect: z.enum(["1:1", "3:2", "2:3"]).default("1:1") }).optional() }).strict().safeParse(payload?.metadata ?? {});
  if (!metadata.success) return errorResponse("图片生成参数不合法", 400, "VALIDATION_ERROR");
  try {
    const quota = await getAiRunQuota({ userId: result.user.id, roomId });
    const created = await createMessage({ roomId, memberId: result.member.id, body: body as string, attachments: [...checkedAttachments.attachments, ...checkedArtifacts.attachments], metadata: metadata.data, aiAllowed: quota.allowed, clientId, mentions: Array.isArray(payload?.mentions) ? payload.mentions : [], replyToId, requestId: getRequestId(request) });
    if (created.aiRun && !created.duplicate && process.env.NODE_ENV !== "production") void triggerAiRun(created.aiRun.id).catch(() => undefined);
    const agentNames = await loadAgentNames();
    return json({
      message: publicMessage(created.message, agentNames),
      duplicate: created.duplicate,
      aiRunId: created.aiRun?.id ?? null,
      aiRunIds: (created as { aiRuns?: Array<{ id: string }> }).aiRuns?.map((run) => run.id) ?? (created.aiRun ? [created.aiRun.id] : []),
      aiRateLimited: !quota.allowed,
      agentRun: created.aiRun ? {
        id: created.aiRun.id,
        agentKey: created.aiRun.targetAgent?.key,
        agentName: created.aiRun.targetAgent?.name,
        mode: created.aiRun.mode,
        status: created.aiRun.status.toLowerCase(),
      } : null,
    }, { status: created.duplicate ? 200 : 201 });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "无法发送消息", 400, "VALIDATION_ERROR");
  }
}
