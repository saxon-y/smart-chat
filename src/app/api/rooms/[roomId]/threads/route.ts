import { getCurrentUser } from "@/lib/auth/session";
import { activeMembership } from "@/lib/chat";
import { createThread } from "@/lib/chat/thread";
import { errorResponse, json } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ roomId: string }> }) {
  const roomId = (await context.params).roomId; const user = await getCurrentUser();
  if (!user) return errorResponse("需要先登录", 401, "UNAUTHENTICATED");
  const member = await activeMembership(roomId, user.id); if (!member) return errorResponse("需要先加入该房间", 403, "FORBIDDEN");
  const body = await request.json().catch(() => ({}));
  if (typeof body.rootMessageId !== "string") return errorResponse("rootMessageId 必填", 400, "VALIDATION_ERROR");
  try { return json({ thread: await createThread(roomId, member.id, body.rootMessageId) }, { status: 201 }); }
  catch (e) { return errorResponse(e instanceof Error ? e.message : "无法创建 Thread", e instanceof Error && e.message === "根消息不存在" ? 404 : 400, "VALIDATION_ERROR"); }
}
