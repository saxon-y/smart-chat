import { getCurrentUser } from "@/lib/auth/session";
import { activeMembership } from "@/lib/chat";
import { retryAiRun } from "@/lib/ai/service";
import { ensureAiWorker, triggerAiRun } from "@/lib/chat/ai-trigger";
import { errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ roomId: string; runId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return errorResponse("需要先登录", 401, "UNAUTHENTICATED");
  const { roomId, runId } = await context.params;
  if (!await activeMembership(roomId, user.id)) return errorResponse("需要先加入该房间", 403, "FORBIDDEN");
  const run = await retryAiRun(roomId, runId);
  if (!run) return errorResponse("任务不存在或已被其他请求更新", 404, "NOT_FOUND");
  if (run.status !== "PENDING") return errorResponse("任务当前不可重试", 409, "RUN_NOT_RETRYABLE");
  ensureAiWorker();
  if (process.env.NODE_ENV !== "production") void triggerAiRun(runId).catch(() => undefined);
  return json({ run: { id: run.id, status: "pending" } });
}
