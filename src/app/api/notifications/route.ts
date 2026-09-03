import { requireUser } from "@/lib/auth/guards";
import { errorResponse, json } from "@/lib/http";
import { listNotifications, markNotificationsRead } from "@/lib/notifications";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const notifications = await listNotifications(user.id, { limit: Number(url.searchParams.get("limit") ?? 40), unreadOnly: url.searchParams.get("unread") === "1" });
    return json({ notifications, unreadCount: notifications.filter((item) => !item.readAt).length });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "需要先登录", error && typeof error === "object" && "status" in error ? Number(error.status) : 401, "UNAUTHENTICATED");
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const payload = await request.json().catch(() => null) as { ids?: unknown } | null;
    const ids = Array.isArray(payload?.ids) && payload.ids.every((id) => typeof id === "string") ? payload.ids as string[] : undefined;
    if (payload?.ids !== undefined && !ids) return errorResponse("通知 ID 格式无效", 400, "VALIDATION_ERROR");
    return json({ marked: await markNotificationsRead(user.id, ids) });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "需要先登录", error && typeof error === "object" && "status" in error ? Number(error.status) : 401, "UNAUTHENTICATED");
  }
}
