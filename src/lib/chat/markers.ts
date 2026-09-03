/* Prisma client regeneration is pending while parallel schema migrations settle. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from "@/lib/db";
import { RoomRole } from "@prisma/client";

export async function listMarkers(roomId: string, memberId: string) {
  const client = db as unknown as { messagePin: any; messageBookmark: any };
  const [pins, bookmarks] = await Promise.all([
    client.messagePin.findMany({ where: { roomId, deletedAt: null }, orderBy: { createdAt: "desc" }, include: { message: true } }),
    client.messageBookmark.findMany({ where: { roomId, memberId, deletedAt: null }, orderBy: { createdAt: "desc" }, include: { message: true } }),
  ]);
  return { pins, bookmarks };
}
export async function toggleMarker(input: { roomId: string; messageId: string; memberId: string; type: "pin" | "bookmark"; active: boolean }) {
  const member = await db.roomMember.findFirst({ where: { id: input.memberId, roomId: input.roomId, leftAt: null } });
  if (!member) throw new Error("FORBIDDEN");
  if (input.type === "pin" && !([RoomRole.OWNER, RoomRole.MODERATOR] as string[]).includes(member.roomRole)) throw new Error("PIN_FORBIDDEN");
  const client = db as unknown as { messagePin: any; messageBookmark: any };
  const message = await db.message.findFirst({ where: { id: input.messageId, roomId: input.roomId, deletedAt: null } });
  if (!message) throw new Error("MESSAGE_NOT_FOUND");
  if (input.type === "pin") {
    const existing = await client.messagePin.findUnique({ where: { roomId_messageId: { roomId: input.roomId, messageId: input.messageId } } });
    if (existing) return client.messagePin.update({ where: { id: existing.id }, data: { deletedAt: input.active ? null : new Date(), pinnedBy: member.id } });
    return client.messagePin.create({ data: { roomId: input.roomId, messageId: input.messageId, pinnedBy: member.id } });
  }
  const existing = await client.messageBookmark.findUnique({ where: { roomId_messageId_memberId: { roomId: input.roomId, messageId: input.messageId, memberId: member.id } } });
  if (existing) return client.messageBookmark.update({ where: { id: existing.id }, data: { deletedAt: input.active ? null : new Date() } });
  return client.messageBookmark.create({ data: { roomId: input.roomId, messageId: input.messageId, memberId: member.id } });
}
