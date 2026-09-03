import { getCurrentUser } from "@/lib/auth/session";
import { activeMembership } from "@/lib/chat";
import { subscribeRoom } from "@/lib/chat/events";
import { db } from "@/lib/db";
import { errorResponse } from "@/lib/http";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ roomId: string; threadId: string }> }) {
  const { roomId, threadId } = await context.params; const user = await getCurrentUser(); if (!user) return errorResponse("需要先登录", 401, "UNAUTHENTICATED"); if (!(await activeMembership(roomId, user.id))) return errorResponse("需要先加入该房间", 403, "FORBIDDEN");
  const encoder = new TextEncoder(); let stop = false; let unsubscribe = () => {}; const stream = new ReadableStream<Uint8Array>({ start(controller) { const send = (v: unknown) => { if (!stop) controller.enqueue(encoder.encode(`data: ${JSON.stringify(v)}\n\n`)); }; unsubscribe = subscribeRoom(roomId, async (event) => { if (event.type !== "thread_reply" || event.threadId !== threadId) return; const reply = await db.threadReply.findUnique({ where: { id: event.replyId } }); if (reply && !reply.deletedAt) send({ type: "thread_reply", reply }); }); const timer = setInterval(() => { if (!stop) send({ type: "keepalive" }); }, 15000); const cleanup = () => { if (stop) return; stop = true; clearInterval(timer); unsubscribe(); try { controller.close(); } catch {} }; request.signal.addEventListener("abort", cleanup); send({ type: "ready", threadId }); } });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" } });
}
