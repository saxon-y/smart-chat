import { getCurrentUser } from "@/lib/auth/session";
import { activeMembership } from "@/lib/chat";
import { searchMessages } from "@/lib/chat/search";
import { errorResponse, json } from "@/lib/http";
import { MessageKind } from "@prisma/client";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ roomId: string }> }) {
  const roomId = (await context.params).roomId;
  const user = await getCurrentUser();
  if (!user) return errorResponse("需要先登录", 401, "UNAUTHENTICATED");
  if (!(await activeMembership(roomId, user.id))) return errorResponse("需要先加入该房间", 403, "FORBIDDEN");
  const url = new URL(request.url); const p = url.searchParams;
  const page = Number(p.get("page") ?? 1); const limit = Number(p.get("limit") ?? 30);
  const kind = p.get("type") ?? p.get("kind");
  if (kind && !Object.values(MessageKind).includes(kind as MessageKind)) return errorResponse("消息类型不合法", 400, "VALIDATION_ERROR");
  const from = p.get("from") ? new Date(p.get("from") as string) : undefined; const to = p.get("to") ? new Date(p.get("to") as string) : undefined;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) return errorResponse("日期不合法", 400, "VALIDATION_ERROR");
  try { return json(await searchMessages({ roomId, q: p.get("q") ?? undefined, senderMemberId: p.get("sender") ?? undefined, from, to, kind: kind as MessageKind | undefined, page: Number.isFinite(page) ? page : 1, limit: Number.isFinite(limit) ? limit : 30 })); }
  catch { return errorResponse("搜索失败", 500, "SEARCH_FAILED"); }
}
