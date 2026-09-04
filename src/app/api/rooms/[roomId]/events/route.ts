import { getCurrentUser } from "@/lib/auth/session";
import { activeMembership, loadAgentNames, publicMessage } from "@/lib/chat";
import { roomSignals, subscribeRoom } from "@/lib/chat/events";
import { db } from "@/lib/db";
import { errorResponse } from "@/lib/http";
import { ensureAiWorker } from "@/lib/chat/ai-trigger";
import { roomPermission } from "@/lib/chat/rooms";

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
  ensureAiWorker();
  const roomId = (await context.params).roomId;
  const result = await auth(roomId);
  if (result.error) return result.error;
  if (!(await roomPermission(result.user.id, roomId, "canView"))) return errorResponse("无权查看该房间", 403, "FORBIDDEN");

  const url = new URL(request.url);
  const after = Number(url.searchParams.get("after") || 0);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let lastOutboxAt = new Date();
      let lastOutboxId = "";
      const seen = new Set<string>();
      const agentNames = await loadAgentNames();
      const send = (data: unknown) => {
        if (closed) return;
        if (data && typeof data === "object") {
          const event = data as { type?: string; runId?: string; status?: string; message?: { id?: string }; messageId?: string };
          const key = event.message?.id ? `message:${event.message.id}` : event.runId ? `${event.type}:${event.runId}:${event.status ?? ""}` : event.messageId ? `${event.type}:${event.messageId}` : "";
          if (key && seen.has(key)) return;
          if (key) seen.add(key);
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      const signals = roomSignals(roomId);
      for (const signal of signals.presence) send({ type: "presence", ...signal });
      for (const signal of signals.typing) send({ type: "typing", ...signal });

      let eventChain = Promise.resolve();
      const unsubscribe = subscribeRoom(roomId, (event) => {
        eventChain = eventChain.then(async () => {
          if (closed) return;
          if (event.type === "message") {
            const full = await db.message.findUnique({
              where: { id: event.messageId },
              include: { senderMember: { include: { user: { select: { displayName: true } } } }, mentions: true, reactions: true },
            });
            if (full && !full.deletedAt) send({ type: "message", message: publicMessage(full, agentNames) });
            return;
          }
          if (event.type === "thread_reply") {
            const reply = await db.threadReply.findUnique({ where: { id: event.replyId }, include: { senderMember: { include: { user: { select: { displayName: true } } } } } });
            if (reply && !reply.deletedAt) send({ type: "thread_reply", threadId: event.threadId, reply: { id: reply.id, threadId: reply.threadId, roomId: reply.roomId, senderMemberId: reply.senderMemberId, senderName: reply.senderMember?.user?.displayName, body: reply.body, sequence: reply.sequence, clientId: reply.clientId ?? undefined, createdAt: reply.createdAt } });
            return;
          }
          if (event.type === "ai_thinking") {
            send({ type: "ai_thinking", agentKey: event.agentKey, agentName: event.agentName, triggerMessageId: event.triggerMessageId });
            return;
          }
          if (event.type === "ai_done") {
            send({ type: "ai_done", agentKey: event.agentKey, triggerMessageId: event.triggerMessageId, ok: event.ok, error: event.error });
            return;
          }
          send(event);
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

      const outboxPoll = setInterval(async () => {
        if (closed) return;
        const events = await db.outboxEvent.findMany({
          where: {
            roomId,
            OR: [
              { createdAt: { gt: lastOutboxAt } },
              { createdAt: lastOutboxAt, id: { gt: lastOutboxId } },
            ],
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 100,
        }).catch(() => []);
        for (const event of events) {
          const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? event.payload : {};
          send({ type: event.type, runId: event.runId, messageId: event.messageId, ...payload });
          lastOutboxAt = event.createdAt;
          lastOutboxId = event.id;
        }
      }, 2000);

      function cleanup() {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        clearInterval(outboxPoll);
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
            include: { senderMember: { include: { user: { select: { displayName: true } } } }, mentions: true, reactions: true },
          });
          for (const message of recent) send({ type: "message", message: publicMessage(message, agentNames) });
          const recentRuns = await db.aiRun.findMany({
            where: { roomId },
            orderBy: { createdAt: "desc" },
            take: 50,
            include: { targetAgent: { select: { key: true, name: true } }, room: { include: { supervisor: { include: { agent: { select: { key: true, name: true } } } } } } },
          });
          for (const run of recentRuns.reverse()) {
            const agent = run.targetAgent ?? run.room.supervisor?.agent;
            const terminal = ["SUCCEEDED", "NO_ACTION", "CANCELLED", "FAILED_FINAL"].includes(run.status);
            send({ type: terminal ? "agent_done" : run.status === "RUNNING" ? "agent_progress" : "agent_queued", runId: run.id, agentKey: agent?.key ?? "room-supervisor", agentName: agent?.name ?? "房间总管", mode: run.mode, status: run.status.toLowerCase(), ok: run.status === "SUCCEEDED" || run.status === "NO_ACTION", error: run.errorCode ?? undefined });
          }
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
