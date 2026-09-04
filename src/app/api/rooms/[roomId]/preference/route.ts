import { getCurrentUser } from "@/lib/auth/session";
import { errorResponse, json } from "@/lib/http";
import { updateRoomPreference } from "@/lib/chat/rooms";
export async function PATCH(request: Request, context: { params: Promise<{ roomId: string }> }) { const user = await getCurrentUser(); if (!user) return errorResponse("需要先登录", 401, "UNAUTHENTICATED"); const body = await request.json().catch(() => ({})); try { return json({ preference: await updateRoomPreference(user.id, (await context.params).roomId, body) }); } catch { return errorResponse("无权修改该房间导航", 403, "FORBIDDEN"); } }
