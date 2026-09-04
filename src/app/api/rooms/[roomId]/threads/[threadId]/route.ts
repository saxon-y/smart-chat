import { getCurrentUser } from "@/lib/auth/session";
import { activeMembership } from "@/lib/chat";
import { roomPermission } from "@/lib/chat/rooms";
import { createThreadReply, listThreadReplies, markThreadRead, publicThreadReply } from "@/lib/chat/thread";
import { db } from "@/lib/db";
import { AiRunMode, PrincipalType } from "@prisma/client";
import { errorResponse, json } from "@/lib/http";
import { configuredRuntimeSnapshot } from "@/lib/ai/runtime-mode";
import { publishAgentEvent } from "@/lib/chat/events";
export const runtime = "nodejs";
async function auth(roomId: string, permission: "canView" | "canPost" = "canView") { const user = await getCurrentUser(); if (!user) return { error: errorResponse("需要先登录", 401, "UNAUTHENTICATED") }; const member = await activeMembership(roomId, user.id); if (!member || !(await roomPermission(user.id, roomId, permission))) return { error: errorResponse("无权访问该 Thread", 403, "FORBIDDEN") }; return { member }; }
export async function GET(request: Request, context: { params: Promise<{ roomId: string; threadId: string }> }) { const { roomId, threadId } = await context.params; const a = await auth(roomId); if (a.error) return a.error; const u = new URL(request.url); const after = Math.max(0, Number(u.searchParams.get("after") ?? 0)); const limit = Number(u.searchParams.get("limit") ?? 50); try { const r = await listThreadReplies(threadId, roomId, Number.isFinite(after) ? after : 0, Number.isFinite(limit) ? limit : 50); return json({ thread: r.thread, replies: r.replies.map(publicThreadReply), nextCursor: r.nextCursor, hasMore: r.hasMore }); } catch (e) { return errorResponse(e instanceof Error ? e.message : "Thread 不存在", 404, "THREAD_NOT_FOUND"); } }
export async function POST(request: Request, context: { params: Promise<{ roomId: string; threadId: string }> }) {
  const { roomId, threadId } = await context.params;
  const a = await auth(roomId, "canPost");
  if (a.error) return a.error;
  const body = await request.json().catch(() => ({}));
  if (typeof body.body !== "string" && typeof body.text !== "string") return errorResponse("正文必填", 400, "VALIDATION_ERROR");
  try {
    const result = await createThreadReply({ roomId, threadId, memberId: a.member.id, body: (body.body ?? body.text) as string, clientId: typeof body.clientId === "string" ? body.clientId : undefined });
    const requestedIds: string[] = Array.isArray(body.agentMemberIds) ? body.agentMemberIds.filter((value: unknown): value is string => typeof value === "string") : [];
    const ids = [...new Set(requestedIds)];
    if (ids.length > 3) return errorResponse("一次最多调用三个 Agent", 400, "AGENT_LIMIT_EXCEEDED");
    const aiRuns = [];
    if (!result.duplicate && ids.length) {
      const thread = await db.thread.findUnique({ where: { id: threadId }, select: { rootMessageId: true } });
      if (!thread) return errorResponse("Thread 不存在", 404, "THREAD_NOT_FOUND");
      const targets = await db.roomMember.findMany({ where: { id: { in: ids }, roomId, principalType: PrincipalType.ASSISTANT, leftAt: null } });
      const agentKeys = targets.flatMap((target) => target.assistantKey ? [target.assistantKey] : []);
      const agents = await db.agent.findMany({ where: { key: { in: agentKeys }, enabled: true, kind: { not: "SUPERVISOR" } } });
      const agentsByKey = new Map(agents.map((agent) => [agent.key, agent]));
      if (targets.length !== ids.length || targets.some((target) => !target.assistantKey || !agentsByKey.has(target.assistantKey))) return errorResponse("Agent 不存在或不可用", 400, "INVALID_AGENT");
      for (const target of targets) {
        const targetAgent = agentsByKey.get(target.assistantKey!);
        const run = await db.aiRun.create({ data: { ...configuredRuntimeSnapshot(), threadId, triggerMessageId: thread.rootMessageId, roomId, callerMemberId: a.member.id, mode: AiRunMode.DIRECT, targetAgentId: targetAgent!.id, targetMemberId: target.id, membershipVersion: target.version, requestId: crypto.randomUUID(), idempotencyKey: `thread:${threadId}:${result.reply.id}:${target.id}` }, include: { targetAgent: true } });
        aiRuns.push(run);
        publishAgentEvent({ type: "agent_queued", roomId, runId: run.id, agentKey: run.targetAgent?.key ?? "agent", agentName: run.targetAgent?.name ?? "AI 助手", mode: run.mode, status: "queued" });
      }
    }
    return json({ reply: publicThreadReply(result.reply), duplicate: result.duplicate, aiRunId: aiRuns[0]?.id ?? null, aiRunIds: aiRuns.map((run) => run.id) }, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法发送回复";
    return errorResponse(message, message === "THREAD_NOT_FOUND" ? 404 : 400, "VALIDATION_ERROR");
  }
}
export async function PATCH(request: Request, context: { params: Promise<{ roomId: string; threadId: string }> }) { const { roomId, threadId } = await context.params; const a = await auth(roomId); if (a.error) return a.error; const body = await request.json().catch(() => ({})); const seq = Number(body.lastSequence); if (!Number.isFinite(seq)) return errorResponse("lastSequence 不合法", 400, "VALIDATION_ERROR"); await markThreadRead(threadId, a.member.id, seq); return json({ lastSequence: Math.max(0, Math.floor(seq)) }); }
