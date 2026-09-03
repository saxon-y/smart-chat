/**
 * In-process MVP message bus. A dedicated worker / Postgres LISTEN-NOTIFY can
 * replace this later; the SSE route subscribes here so new messages push to
 * connected browsers without client-side polling.
 */

export type ChatEvent =
  | { type: "message"; roomId: string; messageId: string }
  | { type: "thread_reply"; roomId: string; threadId: string; replyId: string }
  | { type: "ai_thinking"; roomId: string; agentKey: string; agentName: string; triggerMessageId: string }
  | { type: "ai_done"; roomId: string; agentKey: string; triggerMessageId: string; ok: boolean; error?: string }
  | { type: "presence"; roomId: string; userId: string; displayName: string; online: boolean; expiresAt: number }
  | { type: "typing"; roomId: string; userId: string; displayName: string; expiresAt: number }
  | {
      type: "agent_queued" | "agent_routed" | "agent_progress" | "agent_done";
      roomId: string;
      runId: string;
      agentKey: string;
      agentName: string;
      mode: string;
      status: string;
      progress?: number;
      ok?: boolean;
      error?: string;
    };

type Listener = (event: ChatEvent) => void;

const listenersByRoom = new Map<string, Set<Listener>>();
const presence = new Map<string, { online: boolean; displayName: string; expiresAt: number }>();
const typing = new Map<string, { displayName: string; expiresAt: number }>();
const PRESENCE_TTL = 45_000;
const TYPING_TTL = 4_000;

function pruneSignals(now = Date.now()) {
  for (const [key, value] of presence) if (value.expiresAt <= now) presence.delete(key);
  for (const [key, value] of typing) if (value.expiresAt <= now) typing.delete(key);
}

export function publishPresence(roomId: string, userId: string, displayName: string, online: boolean) {
  pruneSignals();
  const expiresAt = Date.now() + (online ? PRESENCE_TTL : 1);
  presence.set(`${roomId}:${userId}`, { online, displayName, expiresAt });
  publishChatEvent({ type: "presence", roomId, userId, displayName, online, expiresAt });
}

export function publishTyping(roomId: string, userId: string, displayName: string) {
  pruneSignals();
  const expiresAt = Date.now() + TYPING_TTL;
  typing.set(`${roomId}:${userId}`, { displayName, expiresAt });
  publishChatEvent({ type: "typing", roomId, userId, displayName, expiresAt });
}

export function roomSignals(roomId: string) {
  pruneSignals();
  const now = Date.now();
  return {
    presence: [...presence.entries()].filter(([key, value]) => key.startsWith(`${roomId}:`) && value.expiresAt > now).map(([key, value]) => ({ userId: key.slice(roomId.length + 1), ...value })),
    typing: [...typing.entries()].filter(([key, value]) => key.startsWith(`${roomId}:`) && value.expiresAt > now).map(([key, value]) => ({ userId: key.slice(roomId.length + 1), ...value })),
  };
}

export function subscribeRoom(roomId: string, listener: Listener): () => void {
  let set = listenersByRoom.get(roomId);
  if (!set) {
    set = new Set<Listener>();
    listenersByRoom.set(roomId, set);
  }
  set.add(listener);
  return () => {
    const current = listenersByRoom.get(roomId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listenersByRoom.delete(roomId);
  };
}

export function publishChatEvent(event: ChatEvent) {
  const set = listenersByRoom.get(event.roomId);
  if (!set) return;
  set.forEach((listener) => {
    try {
      listener(event);
    } catch {
      // A misbehaving listener must not break delivery to others.
    }
  });
}

export function publishMessage(roomId: string, messageId: string) {
  publishChatEvent({ type: "message", roomId, messageId });
}
export function publishThreadReply(roomId: string, threadId: string, replyId: string) {
  publishChatEvent({ type: "thread_reply", roomId, threadId, replyId });
}

export function publishAiThinking(roomId: string, agentKey: string, agentName: string, triggerMessageId: string) {
  publishChatEvent({ type: "ai_thinking", roomId, agentKey, agentName, triggerMessageId });
}

export function publishAiDone(roomId: string, agentKey: string, triggerMessageId: string, ok: boolean, error?: string) {
  publishChatEvent({ type: "ai_done", roomId, agentKey, triggerMessageId, ok, error });
}

export function publishAgentEvent(event: Extract<ChatEvent, { type: "agent_queued" | "agent_routed" | "agent_progress" | "agent_done" }>) {
  publishChatEvent(event);
}
