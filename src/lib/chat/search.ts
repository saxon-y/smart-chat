import { MessageKind, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { loadAgentNames, publicMessage } from "./index";

export type MessageSearchInput = { roomId: string; q?: string; senderMemberId?: string; from?: Date; to?: Date; kind?: MessageKind; page?: number; limit?: number };

export async function searchMessages(input: MessageSearchInput) {
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
  const page = Math.max(input.page ?? 1, 1);
  const where: Prisma.MessageWhereInput = { roomId: input.roomId, deletedAt: null };
  if (input.q?.trim()) where.body = { contains: input.q.trim(), mode: "insensitive" };
  if (input.senderMemberId) where.senderMemberId = input.senderMemberId;
  if (input.kind) where.kind = input.kind;
  if (input.from || input.to) where.createdAt = { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lt: input.to } : {}) };
  const [rows, total, agentNames] = await Promise.all([
    db.message.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * limit, take: limit, include: { senderMember: { include: { user: { select: { displayName: true } } } }, mentions: true } }),
    db.message.count({ where }),
    loadAgentNames(),
  ]);
  return { messages: rows.map((row) => publicMessage(row, agentNames)), page, limit, total, hasMore: page * limit < total };
}
