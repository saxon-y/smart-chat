import { getCurrentUser } from "@/lib/auth/session";
import { activeMembership } from "@/lib/chat";
import { markRoomRead, unreadSummary } from "@/lib/chat/unread";
import { errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await context.params;
  const user = await getCurrentUser();
  if (!user) return errorResponse("需要先登录", 401, "UNAUTHENTICATED");
  const member = await activeMembership(roomId, user.id);
  if (!member) return errorResponse("需要先加入该房间", 403, "FORBIDDEN");
  const summary = await unreadSummary(member.id, roomId);
  return json(summary.rooms[0] ?? { roomId, lastSequence: 0, lastRead: 0, unread: 0, threads: [] });
}

export async function PATCH(request: Request, context: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await context.params;
  const user = await getCurrentUser();
  if (!user) return errorResponse("需要先登录", 401, "UNAUTHENTICATED");
  const member = await activeMembership(roomId, user.id);
  if (!member) return errorResponse("需要先加入该房间", 403, "FORBIDDEN");
  const body = await request.json().catch(() => ({}));
  const sequence = Number(body.lastSequence);
  if (!Number.isFinite(sequence)) return errorResponse("lastSequence 不合法", 400, "VALIDATION_ERROR");
  const read = await markRoomRead(roomId, member.id, sequence);
  return json({ roomId, lastSequence: read.lastSequence });
}
