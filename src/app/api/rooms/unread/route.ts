import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { activeMembership } from "@/lib/chat";
import { unreadSummary } from "@/lib/chat/unread";
import { errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return errorResponse("需要先登录", 401, "UNAUTHENTICATED");
  const memberships = await db.roomMember.findMany({ where: { userId: user.id, leftAt: null }, select: { id: true } });
  const summaries = await Promise.all(memberships.map((member) => unreadSummary(member.id)));
  const rooms = summaries.flatMap((summary) => summary.rooms);
  return json({ rooms, total: rooms.reduce((sum, room) => sum + room.unread + room.threads.reduce((n, thread) => n + thread.unread, 0), 0) });
}
