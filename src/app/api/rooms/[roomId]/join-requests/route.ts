import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { activeMembership, joinRoom } from "@/lib/chat";
import { errorResponse, json } from "@/lib/http";

export async function POST(request: Request, context: { params: Promise<{ roomId: string }> }) {
  const user = await getCurrentUser(); if (!user) return errorResponse("需要先登录", 401, "UNAUTHENTICATED");
  const roomId = (await context.params).roomId; const room = await db.room.findUnique({ where: { id: roomId } });
  if (!room || room.status !== "ACTIVE") return errorResponse("房间不存在", 404, "NOT_FOUND");
  if (await activeMembership(roomId, user.id)) return errorResponse("已经是房间成员", 409, "ALREADY_MEMBER");
  if (room.visibility !== "PUBLIC") return errorResponse("该房间不接受公开申请", 403, "INVITE_ONLY");
  const body = await request.json().catch(() => ({}));
  const existing = await db.roomJoinRequest.findFirst({ where: { roomId, userId: user.id, status: "PENDING" } });
  if (existing) return json({ request: existing });
  const created = await db.roomJoinRequest.create({ data: { roomId, userId: user.id, reason: typeof body.reason === "string" ? body.reason.slice(0, 500) : undefined } });
  return json({ request: created }, { status: 201 });
}

export async function GET(_request: Request, context: { params: Promise<{ roomId: string }> }) {
  const user = await getCurrentUser(); if (!user) return errorResponse("需要先登录", 401, "UNAUTHENTICATED");
  const roomId = (await context.params).roomId; const membership = await activeMembership(roomId, user.id);
  if (!membership || !["OWNER", "MODERATOR"].includes(membership.roomRole)) return errorResponse("无权限", 403, "FORBIDDEN");
  const requests = await db.roomJoinRequest.findMany({ where: { roomId }, orderBy: { createdAt: "desc" }, include: { user: { select: { id: true, displayName: true, avatarKey: true } } } });
  return json({ requests });
}
