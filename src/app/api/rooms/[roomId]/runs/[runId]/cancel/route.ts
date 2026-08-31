import { getCurrentUser } from "@/lib/auth/session";
import { activeMembership } from "@/lib/chat";
import { cancelAiRun } from "@/lib/ai/service";
import { errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ roomId: string; runId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return errorResponse("需要先登录", 401, "UNAUTHENTICATED");
  const { roomId, runId } = await context.params;
  if (!await activeMembership(roomId, user.id)) return errorResponse("需要先加入该房间", 403, "FORBIDDEN");
  const run = await cancelAiRun(roomId, runId);
  if (!run) return errorResponse("任务不存在", 404, "NOT_FOUND");
  if (run.status !== "CANCELLED") return errorResponse("任务已结束，无法取消", 409, "RUN_NOT_CANCELLABLE");
  return json({ run: { id: run.id, status: "cancelled", errorCode: null } });
}
