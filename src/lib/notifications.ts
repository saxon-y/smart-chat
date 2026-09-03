import { NotificationType, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

const MAX_SUMMARY = 240;

export type NotificationInput = {
  userId: string;
  roomId?: string | null;
  type: NotificationType;
  title: string;
  summary: string;
  sourceId?: string | null;
  sourceType?: string | null;
  dedupeKey: string;
  expiresAt?: Date | null;
};

export function compactSummary(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_SUMMARY);
}

export async function createNotification(input: NotificationInput, client: Prisma.TransactionClient | typeof db = db) {
  return client.notification.upsert({
    where: { dedupeKey: input.dedupeKey },
    create: { ...input, title: input.title.trim().slice(0, 120), summary: compactSummary(input.summary) },
    update: {},
  });
}

export async function listNotifications(userId: string, options: { limit?: number; unreadOnly?: boolean } = {}) {
  const limit = Math.max(1, Math.min(options.limit ?? 40, 100));
  const now = new Date();
  return db.notification.findMany({
    where: { userId, ...(options.unreadOnly ? { readAt: null } : {}), OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: { id: true, roomId: true, type: true, title: true, summary: true, sourceId: true, sourceType: true, readAt: true, createdAt: true },
  });
}

export async function markNotificationsRead(userId: string, ids?: string[]) {
  const result = await db.notification.updateMany({ where: { userId, ...(ids?.length ? { id: { in: ids } } : {}), readAt: null }, data: { readAt: new Date() } });
  return result.count;
}
