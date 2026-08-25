import { db } from "@/lib/db";
import { errorResponse, json } from "@/lib/http";
export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ roomId: string }> }) {
  const roomId = (await context.params).roomId;
  const room = await db.room.findUnique({ where: { id: roomId }, include: { _count: { select: { members: true } } } });
  if (!room || room.visibility !== "PUBLIC" || room.status !== "ACTIVE") return errorResponse("房间不存在", 404, "NOT_FOUND");
  return json({ room: { id: room.id, name: room.name, slug: room.slug, visibility: room.visibility, status: room.status, memberCount: room._count.members, createdAt: room.createdAt, updatedAt: room.updatedAt } });
}
