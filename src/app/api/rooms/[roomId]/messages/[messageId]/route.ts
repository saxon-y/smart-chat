import { getCurrentUser } from "@/lib/auth/session";
import { activeMembership, deleteMessage, editMessage, loadAgentNames, publicMessage } from "@/lib/chat";
import { errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";

async function auth(roomId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: errorResponse("需要先登录", 401, "UNAUTHENTICATED") };
  const member = await activeMembership(roomId, user.id);
  if (!member) return { error: errorResponse("需要先加入该房间", 403, "FORBIDDEN") };
  return { user, member };
}

export async function PATCH(request: Request, context: { params: Promise<{ roomId: string; messageId: string }> }) {
  const { roomId, messageId } = await context.params;
  const result = await auth(roomId);
  if (result.error) return result.error;
  const payload = await request.json().catch(() => null) as { body?: unknown; text?: unknown } | null;
  const body = payload?.body ?? payload?.text;
  if (typeof body !== "string") return errorResponse("消息内容不合法", 400, "VALIDATION_ERROR");
  try {
    const message = await editMessage({ roomId, memberId: result.member.id, messageId, body });
    return json({ message: publicMessage(message, await loadAgentNames()) });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "无法编辑消息", 400, "VALIDATION_ERROR");
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ roomId: string; messageId: string }> }) {
  const { roomId, messageId } = await context.params;
  const result = await auth(roomId);
  if (result.error) return result.error;
  try {
    await deleteMessage({ roomId, memberId: result.member.id, messageId });
    return json({ ok: true, messageId });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "无法删除消息", 400, "VALIDATION_ERROR");
  }
}
