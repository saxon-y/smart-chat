import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { activeMembership } from "@/lib/chat";
import { publishPresence, publishTyping } from "@/lib/chat/events";
import { errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";
const schema = z.strictObject({ type: z.enum(["presence", "typing"]), online: z.boolean().optional() });

export async function POST(request: Request, context: { params: Promise<{ roomId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return errorResponse("需要先登录", 401, "UNAUTHENTICATED");
  const { roomId } = await context.params;
  if (!(await activeMembership(roomId, user.id))) return errorResponse("需要先加入该房间", 403, "FORBIDDEN");
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse("状态信号无效", 400, "INVALID_PRESENCE");
  if (parsed.data.type === "typing") publishTyping(roomId, user.id, user.displayName);
  else publishPresence(roomId, user.id, user.displayName, parsed.data.online !== false);
  return json({ ok: true });
}
