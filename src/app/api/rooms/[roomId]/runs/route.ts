import { getCurrentUser } from "@/lib/auth/session";
import { activeMembership } from "@/lib/chat";
import { listRoomAiRuns } from "@/lib/ai/service";
import { errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ roomId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return errorResponse("需要先登录", 401, "UNAUTHENTICATED");
  const roomId = (await context.params).roomId;
  if (!await activeMembership(roomId, user.id)) return errorResponse("需要先加入该房间", 403, "FORBIDDEN");
  const url = new URL(request.url);
  const requested = Number(url.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(100, requested)) : 50;
  const rows = await listRoomAiRuns(roomId, limit, url.searchParams.get("cursor") ?? undefined);
  const hasMore = rows.length > limit;
  const runs = rows.slice(0, limit);
  return json({ runs: runs.map((run) => ({
    id: run.id,
    roomId: run.roomId,
    triggerMessageId: run.triggerMessageId,
    mode: run.mode,
    status: run.status.toLowerCase(),
    attempt: run.attempt,
    errorCode: run.errorCode,
    decision: run.decision,
    decisionConfidence: run.decisionConfidence,
    targetMemberId: run.targetMemberId,
    targetAgent: run.targetAgent,
    triggerMessage: run.triggerMessage,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  })), nextCursor: hasMore ? runs.at(-1)?.id ?? null : null });
}
