import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { activeMembership, joinRoom, loadAgentNames, loadAgentStyles, markOwnMembership, publicMember } from "@/lib/chat";
import { errorResponse, json } from "@/lib/http";
export const runtime = "nodejs";
async function roomAndUser(roomId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: errorResponse("需要先登录", 401, "UNAUTHENTICATED") };
  const membership = await activeMembership(roomId, user.id);
  if (!membership) return { error: errorResponse("需要先加入该房间", 403, "FORBIDDEN") };
  return { user, membership };
}
export async function GET(_request: Request, context: { params: Promise<{ roomId: string }> }) {
  const roomId = (await context.params).roomId; const result = await roomAndUser(roomId); if (result.error) return result.error;
  const [members, agentNames, agentStyles] = await Promise.all([
    db.roomMember.findMany({ where: { roomId, leftAt: null }, orderBy: { joinedAt: "asc" }, select: { id: true, principalType: true, assistantKey: true, userId: true, roomRole: true, joinedAt: true, leftAt: true, user: { select: { displayName: true, avatarKey: true } } } }),
    loadAgentNames(),
    loadAgentStyles(),
  ]);
  return json({ members: markOwnMembership(members.map((m) => publicMember(m, agentNames, agentStyles)), result.user.id) });
}
export async function POST(_request: Request, context: { params: Promise<{ roomId: string }> }) {
  const roomId = (await context.params).roomId; const user = await getCurrentUser(); if (!user) return errorResponse("需要先登录", 401, "UNAUTHENTICATED");
  const room = await db.room.findUnique({ where: { id: roomId }, select: { id: true, visibility: true, status: true } });
  if (!room || room.visibility !== "PUBLIC" || room.status !== "ACTIVE") return errorResponse("房间不存在", 404, "NOT_FOUND");
  const existing = await activeMembership(roomId, user.id);
  if (existing) return json({ member: publicMember(existing) });
  const adminMembership = await db.roomMember.findFirst({ where: { roomId, userId: user.id, leftAt: null, roomRole: { in: ["OWNER", "MODERATOR"] } } });
  if (!adminMembership) return errorResponse("请先提交加入申请", 403, "JOIN_REQUEST_REQUIRED");
  const member = await joinRoom(roomId, user.id); return json({ member: publicMember(member) }, { status: 201 });
}
export async function DELETE(_request: Request, context: { params: Promise<{ roomId: string }> }) {
  const roomId = (await context.params).roomId; const user = await getCurrentUser(); if (!user) return errorResponse("需要先登录", 401, "UNAUTHENTICATED");
  const member = await activeMembership(roomId, user.id); if (!member) return errorResponse("需要先加入该房间", 403, "FORBIDDEN");
  await db.roomMember.update({ where: { id: member.id }, data: { leftAt: new Date(), version: { increment: 1 } } }); return json({ ok: true });
}
