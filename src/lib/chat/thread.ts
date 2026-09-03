import { PrincipalType } from "@prisma/client";
import { db } from "@/lib/db";
import { publishThreadReply } from "./events";
import { validateMessageBody } from "./validation";
import { createNotification } from "@/lib/notifications";

export async function createThread(roomId: string, memberId: string, rootMessageId: string) {
  const root = await db.message.findFirst({ where: { id: rootMessageId, roomId, deletedAt: null } });
  if (!root) throw new Error("根消息不存在");
  const member = await db.roomMember.findFirst({ where: { id: memberId, roomId, principalType: PrincipalType.USER, leftAt: null } });
  if (!member) throw new Error("需要先加入该房间");
  const existing = await db.thread.findUnique({ where: { rootMessageId } });
  if (existing) {
    if (existing.roomId !== roomId) throw new Error("根消息不存在");
    return existing;
  }
  return db.thread.create({ data: { roomId, rootMessageId, createdByMemberId: memberId } });
}

export async function listThreadReplies(threadId: string, roomId: string, after = 0, limit = 50) {
  const thread = await db.thread.findFirst({ where: { id: threadId, roomId } });
  if (!thread) throw new Error("THREAD_NOT_FOUND");
  const rows = await db.threadReply.findMany({ where: { threadId, deletedAt: null, ...(after > 0 ? { sequence: { gt: after } } : {}) }, orderBy: { sequence: "asc" }, take: Math.min(Math.max(limit, 1), 100), include: { senderMember: { include: { user: { select: { displayName: true } } } } } });
  return { thread, replies: rows, nextCursor: rows.at(-1)?.sequence ?? after, hasMore: rows.length === Math.min(Math.max(limit, 1), 100) };
}

export async function createThreadReply(input: { threadId: string; roomId: string; memberId: string; body: string; clientId?: string }) {
  const checked = validateMessageBody(input.body);
  if (!checked.ok) throw new Error(checked.message);
  const result = await db.$transaction(async (tx) => {
    const thread = await tx.thread.findFirst({ where: { id: input.threadId, roomId: input.roomId } });
    if (!thread) throw new Error("THREAD_NOT_FOUND");
    const member = await tx.roomMember.findFirst({ where: { id: input.memberId, roomId: input.roomId, principalType: PrincipalType.USER, leftAt: null } });
    if (!member) throw new Error("需要先加入该房间");
    if (input.clientId) {
      const existing = await tx.threadReply.findFirst({ where: { threadId: thread.id, senderMemberId: member.id, clientId: input.clientId } });
      if (existing) return { reply: existing, duplicate: true };
    }
    const updated = await tx.thread.update({ where: { id: thread.id }, data: { lastSequence: { increment: 1 }, updatedAt: new Date() } });
    const reply = await tx.threadReply.create({ data: { threadId: thread.id, roomId: input.roomId, senderMemberId: member.id, body: checked.body, clientId: input.clientId, sequence: updated.lastSequence }, include: { senderMember: { include: { user: { select: { displayName: true } } } } } });
    return { reply, duplicate: false };
  });
  if (!result.duplicate) publishThreadReply(input.roomId, input.threadId, result.reply.id);
  if (!result.duplicate) {
    const recipients = await db.roomMember.findMany({ where: { roomId: input.roomId, principalType: PrincipalType.USER, leftAt: null, id: { not: input.memberId }, OR: [{ createdThreads: { some: { id: input.threadId } } }, { threadReplies: { some: { threadId: input.threadId } } }] }, select: { userId: true } });
    await Promise.all(recipients.filter((member) => member.userId).map((member) => createNotification({ userId: member.userId!, roomId: input.roomId, type: "THREAD_REPLY", title: "Thread 有新回复", summary: checked.body, sourceId: result.reply.id, sourceType: "thread_reply", dedupeKey: `thread_reply:${result.reply.id}:${member.userId}` })));
  }
  return result;
}

export async function markThreadRead(threadId: string, memberId: string, sequence: number) {
  const value = Math.max(0, Math.floor(sequence));
  return db.$transaction(async (tx) => {
    const existing = await tx.threadRead.findUnique({ where: { threadId_memberId: { threadId, memberId } } });
    if (!existing) return tx.threadRead.create({ data: { threadId, memberId, lastSequence: value } });
    if (value <= existing.lastSequence) return existing;
    return tx.threadRead.update({ where: { threadId_memberId: { threadId, memberId } }, data: { lastSequence: value } });
  });
}

type ThreadReplyPublic = { id: string; threadId: string; roomId: string; senderMemberId: string; body: string; sequence: number; clientId: string | null; createdAt: Date; senderMember?: { user?: { displayName: string } | null } | null };
export function publicThreadReply(reply: ThreadReplyPublic) {
  return { id: reply.id, threadId: reply.threadId, roomId: reply.roomId, senderMemberId: reply.senderMemberId, senderName: reply.senderMember?.user?.displayName, body: reply.body, sequence: reply.sequence, clientId: reply.clientId ?? undefined, createdAt: reply.createdAt };
}
