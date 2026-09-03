import { getCurrentUser } from "@/lib/auth/session";
import { activeMembership, ALLOWED_REACTION_EMOJIS, toggleMessageReaction } from "@/lib/chat";
import { errorResponse, json } from "@/lib/http";

export async function POST(request: Request, context: { params: Promise<{ roomId: string; messageId: string }> }) {
  const { roomId, messageId } = await context.params;
  const user = await getCurrentUser();
  if (!user) return errorResponse("需要先登录", 401, "UNAUTHENTICATED");
  const member = await activeMembership(roomId, user.id);
  if (!member) return errorResponse("需要先加入该房间", 403, "FORBIDDEN");
  const payload = await request.json().catch(() => null) as { emoji?: unknown } | null;
  if (typeof payload?.emoji !== "string" || !(ALLOWED_REACTION_EMOJIS as readonly string[]).includes(payload.emoji)) return errorResponse("不支持的表情", 400, "VALIDATION_ERROR");
  try { return json(await toggleMessageReaction({ roomId, messageId, memberId: member.id, emoji: payload.emoji })); }
  catch (error) { return errorResponse(error instanceof Error ? error.message : "无法设置表情", 400, "VALIDATION_ERROR"); }
}
