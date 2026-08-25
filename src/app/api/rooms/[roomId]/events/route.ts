import { getCurrentUser } from "@/lib/auth/session";
import { activeMembership, loadAgentNames, publicMessage } from "@/lib/chat";
import { subscribeRoom } from "@/lib/chat/events";
import { db } from "@/lib/db";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function auth(roomId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: errorResponse("需要先登录", 401, "UNAUTHENTICATED") };
  const member = await activeMembership(roomId, user.id);
  if (!member) return { error: errorResponse("需要先加入该房间", 403, "FORBIDDEN") };
  return { user, member };
}

export async function GET(request: Request, context: { params: Promise<{ roomId: string }> }) {
  const roomId = (await context.params).roomId;
  const result = await auth(roomId);
  if (result.error) return result.error;

  const url = new URL(request.url);
  const after = Number(url.searchParams.get("after") || 0);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const agentNames = await loadAgentNames();
      const send = (data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      let eventChain = Promise.resolve();
      const unsubscribe = subscribeRoom(roomId, (event) => {
        eventChain = eventChain.then(async () => {
          if (closed) return;
          if (event.type === "message") {
            const full = await db.message.findUnique({
              where: { id: event.messageId },
              include: { senderMember: { include: { user: { select: { displayName: true } } } }, mentions: true },
            });
            if (full && !full.deletedAt) send({ type: "message", message: publicMessage(full, agentNames) });
            return;
          }
          if (event.type === "ai_thinking") {
            send({ type: "ai_thinking", agentKey: event.agentKey, agentName: event.agentName, triggerMessageId: event.triggerMessageId });
            return;
          }
          if (event.type === "ai_done") {
            send({ type: "ai_done", agentKey: event.agentKey, triggerMessageId: event.triggerMessageId, ok: event.ok, error: event.error });
          }
        }).catch(() => undefined);
      });

      const keepalive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          cleanup();
        }
      }, 15000);

      function cleanup() {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      }

      // Catch up on anything created before the stream opened, then signal ready.
      (async () => {
        try {
          const recent = await db.message.findMany({
            where: { roomId, deletedAt: null, ...(after > 0 ? { roomSequence: { gt: after } } : {}) },
            orderBy: { roomSequence: "asc" },
            take: 200,
            include: { senderMember: { include: { user: { select: { displayName: true } } } }, mentions: true },
          });
          for (const message of recent) send({ type: "message", message: publicMessage(message, agentNames) });
          send({ type: "ready", lastSequence: recent.at(-1)?.roomSequence ?? after });
        } catch {
          cleanup();
        }
      })();

      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
