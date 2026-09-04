import { getCurrentUser } from "@/lib/auth/session";
import { isUserAdmin } from "@/lib/auth/permissions";
import { activeMembership } from "@/lib/chat";
import { db } from "@/lib/db";
import { errorResponse, json } from "@/lib/http";

export async function GET(_request: Request, context: { params: Promise<{ roomId: string }> }) {
  const user = await getCurrentUser(); if (!user) return errorResponse("需要先登录", 401, "UNAUTHENTICATED");
  const roomId = (await context.params).roomId; if (!await activeMembership(roomId, user.id)) return errorResponse("无权查看该房间", 403, "FORBIDDEN");
  return json({ permissions: await db.roomPermission.findMany({ where: { roomId }, select: { userId: true, canView: true, canPost: true, canAddAgent: true, canApprove: true, canArtifacts: true } }) });
}

export async function PATCH(request: Request, context: { params: Promise<{ roomId: string }> }) {
  const user = await getCurrentUser(); if (!user) return errorResponse("需要先登录", 401, "UNAUTHENTICATED");
  const roomId = (await context.params).roomId; const actor = await activeMembership(roomId, user.id); const admin = await isUserAdmin(user.id, user.role); if (!admin && (!actor || !["OWNER", "MODERATOR"].includes(actor.roomRole))) return errorResponse("需要管理员权限", 403, "FORBIDDEN");
  const body = await request.json().catch(() => null) as Record<string, unknown> | null; const userId = typeof body?.userId === "string" ? body.userId : ""; if (!userId) return errorResponse("userId 必填", 400, "VALIDATION_ERROR");
  const bool = (key: string) => body?.[key] === undefined ? undefined : body[key] === true;
  const target = await db.roomMember.findFirst({ where: { roomId, userId, principalType: "USER", leftAt: null }, select: { id: true } }); if (!target) return errorResponse("成员不存在", 404, "NOT_FOUND");
  return json({ permission: await db.roomPermission.upsert({ where: { roomId_userId: { roomId, userId } }, create: { roomId, userId, canView: bool("canView") ?? true, canPost: bool("canPost") ?? true, canAddAgent: bool("canAddAgent") ?? false, canApprove: bool("canApprove") ?? false, canArtifacts: bool("canArtifacts") ?? true }, update: Object.fromEntries(["canView", "canPost", "canAddAgent", "canApprove", "canArtifacts"].flatMap((key) => bool(key) === undefined ? [] : [[key, bool(key)]])) }) });
}
