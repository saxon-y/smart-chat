import { PrincipalType, RoomRole } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { errorResponse, json, getRequestId } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.trim();
  const requestedLimit = Number(url.searchParams.get("limit") || 50); const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 100)) : 50;
  const rooms = await db.room.findMany({ where: { visibility: "PUBLIC", status: "ACTIVE", ...(search ? { name: { contains: search, mode: "insensitive" } } : {}) }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: limit, include: { _count: { select: { members: true } } } });
  return json({ rooms: rooms.map((room) => ({ id: room.id, name: room.name, slug: room.slug, visibility: room.visibility, status: room.status, memberCount: room._count.members, updatedAt: room.updatedAt, createdAt: room.createdAt })) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return errorResponse("需要先登录", 401, "UNAUTHENTICATED");
  const payload = await request.json().catch(() => null) as { name?: unknown } | null;
  const name = typeof payload?.name === "string" ? payload.name.trim() : "";
  if (!name || name.length > 80) return errorResponse("房间名称必填，且不能超过 80 个字符", 400, "VALIDATION_ERROR");
  const base = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "room";
  const room = await db.$transaction(async (tx) => {
    let slug = base;
    for (let index = 1; await tx.room.findUnique({ where: { slug } }); index += 1) slug = `${base}-${index}`;
    const supervisor = await tx.agent.findFirst({ where: { kind: "SUPERVISOR", enabled: true }, orderBy: { createdAt: "asc" } });
    if (!supervisor) throw new Error("room_supervisor_not_configured");
    return tx.room.create({ data: { name, slug, createdById: user.id, supervisor: { create: { agentId: supervisor.id } }, members: { create: [{ userId: user.id, principalType: PrincipalType.USER, roomRole: RoomRole.OWNER }, { principalType: PrincipalType.ASSISTANT, assistantKey: "da-cong-ming" }] } }, include: { _count: { select: { members: true } } } });
  });
  return json({ room: { id: room.id, name: room.name, slug: room.slug, visibility: room.visibility, status: room.status, memberCount: room._count.members, createdAt: room.createdAt, updatedAt: room.updatedAt } }, { status: 201, headers: { "x-request-id": getRequestId(request) } });
}
