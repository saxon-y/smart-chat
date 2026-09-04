import { db } from "@/lib/db";
export async function listConclusions(threadId: string, roomId: string) { return db.threadConclusion.findMany({ where: { threadId, roomId, deletedAt: null }, orderBy: { createdAt: "desc" } }); }
export async function upsertConclusion(input: { threadId: string; roomId: string; memberId: string; summary: string; sources: unknown[]; model?: string; confirmed: boolean }) {
  const thread = await db.thread.findFirst({ where: { id: input.threadId, roomId: input.roomId } }); if (!thread) throw new Error("THREAD_NOT_FOUND");
  const summary = input.summary.trim().slice(0, 4000); if (!summary || /api[_-]?key|password|secret|token/i.test(summary)) throw new Error("SENSITIVE_CONTENT");
  const sources = input.sources.filter((s) => typeof s === "string").slice(0, 50);
  const valid = await db.threadReply.findMany({ where: { threadId: input.threadId, roomId: input.roomId, deletedAt: null }, select: { id: true } });
  const root = await db.thread.findUnique({ where: { id: input.threadId }, select: { rootMessageId: true } });
  const allowed = new Set([root?.rootMessageId, ...valid.map((r) => r.id)]);
  if (sources.some((source) => !allowed.has(source))) throw new Error("INVALID_SOURCE");
  return db.threadConclusion.upsert({ where: { threadId_createdBy: { threadId: input.threadId, createdBy: input.memberId } }, create: { threadId: input.threadId, roomId: input.roomId, createdBy: input.memberId, summary, sources, model: input.model?.slice(0, 200), confirmedAt: input.confirmed ? new Date() : null }, update: { summary, sources, model: input.model?.slice(0, 200), confirmedAt: input.confirmed ? new Date() : null, deletedAt: null } });
}
export async function generateConclusionDraft(threadId: string, roomId: string) { const thread = await db.thread.findFirst({ where: { id: threadId, roomId }, include: { rootMessage: true, replies: { where: { deletedAt: null }, orderBy: { sequence: "asc" } } } }); if (!thread) throw new Error("THREAD_NOT_FOUND"); return { summary: [thread.rootMessage, ...thread.replies].map((m) => m.body.trim()).filter(Boolean).join(" ").slice(0, 1000), sources: [thread.rootMessageId, ...thread.replies.map((r) => r.id)], model: "thread-summary-v1" }; }
