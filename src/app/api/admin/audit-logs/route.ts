import { db } from "@/lib/db";
import { requireAdmin, AuthError } from "@/lib/auth/guards";
import { errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";

function decodeCursor(value: string | null) {
  if (!value) return null;
  try { const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); return parsed.createdAt && parsed.id ? parsed : null; } catch { return null; }
}
function encodeCursor(value: { createdAt: Date; id: string }) { return Buffer.from(JSON.stringify({ createdAt: value.createdAt.toISOString(), id: value.id })).toString("base64url"); }

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50) || 50, 1), 100);
    const cursor = decodeCursor(url.searchParams.get("cursor"));
    const where = { ...(url.searchParams.get("actorId") ? { actorId: url.searchParams.get("actorId")! } : {}), ...(url.searchParams.get("action") ? { action: url.searchParams.get("action")! } : {}), ...(url.searchParams.get("from") || url.searchParams.get("to") ? { createdAt: { ...(url.searchParams.get("from") ? { gte: new Date(url.searchParams.get("from")!) } : {}), ...(url.searchParams.get("to") ? { lte: new Date(url.searchParams.get("to")!) } : {}) } } : {}), ...(cursor ? { OR: [{ createdAt: { lt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } }] } : {}) };
    const rows = await db.auditLog.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1, include: { actor: { select: { id: true, displayName: true, email: true } } } });
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => ({ id: row.id, actor: row.actor, action: row.action, targetType: row.targetType, targetId: row.targetId, before: row.before, after: row.after, result: row.result, requestId: row.requestId, createdAt: row.createdAt }));
    return json({ items, nextCursor: hasMore ? encodeCursor(rows[limit]) : null });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status, error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
    return errorResponse("无法加载审计日志", 500, "AUDIT_LOG_ERROR");
  }
}
