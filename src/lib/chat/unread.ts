import { db } from "@/lib/db";

function cursor(value: number) {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
}

export async function markRoomRead(roomId: string, memberId: string, sequence: number) {
  const value = cursor(sequence);
  return db.$transaction(async (tx) => {
    const existing = await tx.roomRead.findUnique({ where: { roomId_memberId: { roomId, memberId } } });
    if (!existing) return tx.roomRead.create({ data: { roomId, memberId, lastSequence: value } });
    if (value <= existing.lastSequence) return existing;
    return tx.roomRead.update({ where: { roomId_memberId: { roomId, memberId } }, data: { lastSequence: value } });
  });
}

export async function unreadSummary(memberId: string, roomId?: string) {
  const memberships = await db.roomMember.findMany({ where: { id: memberId, leftAt: null, ...(roomId ? { roomId } : {}) }, select: { roomId: true } });
  const roomIds = memberships.map((m) => m.roomId);
  if (!roomIds.length) return { rooms: [], total: 0 };
  const [rooms, reads, messageCounts, threads] = await Promise.all([
    db.room.findMany({ where: { id: { in: roomIds } }, select: { id: true, lastSequence: true } }),
    db.roomRead.findMany({ where: { memberId, roomId: { in: roomIds } }, select: { roomId: true, lastSequence: true } }),
    db.message.findMany({ where: { roomId: { in: roomIds }, deletedAt: null }, select: { roomId: true, roomSequence: true } }),
    db.thread.findMany({ where: { roomId: { in: roomIds } }, select: { id: true, roomId: true, lastSequence: true, reads: { where: { memberId }, select: { lastSequence: true } }, replies: { where: { deletedAt: null }, select: { sequence: true } } } }),
  ]);
  const readByRoom = new Map(reads.map((r) => [r.roomId, r.lastSequence]));
  const threadResults = threads.map((thread) => {
    const lastRead = thread.reads[0]?.lastSequence ?? 0;
    return { threadId: thread.id, roomId: thread.roomId, lastSequence: thread.lastSequence, lastRead, unread: thread.replies.filter((r) => r.sequence > lastRead).length };
  });
  const result = rooms.map((room) => {
    const lastRead = readByRoom.get(room.id) ?? 0;
    const count = messageCounts.filter((message) => message.roomId === room.id && message.roomSequence > lastRead).length;
    const roomThreads = threadResults.filter((t) => t.roomId === room.id);
    return { roomId: room.id, lastSequence: room.lastSequence, lastRead, unread: count, threads: roomThreads };
  });
  return { rooms: result, total: result.reduce((sum, room) => sum + room.unread + room.threads.reduce((n, t) => n + t.unread, 0), 0) };
}
