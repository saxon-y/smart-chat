/**
 * In-process MVP message bus. A dedicated worker / Postgres LISTEN-NOTIFY can
 * replace this later; the SSE route subscribes here so new messages push to
 * connected browsers without client-side polling.
 */

export type ChatEvent =
  | { type: "message"; roomId: string; messageId: string }
  | { type: "ai_thinking"; roomId: string; agentKey: string; agentName: string; triggerMessageId: string }
  | { type: "ai_done"; roomId: string; agentKey: string; triggerMessageId: string; ok: boolean; error?: string };

type Listener = (event: ChatEvent) => void;

const listenersByRoom = new Map<string, Set<Listener>>();

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

export function publishAiThinking(roomId: string, agentKey: string, agentName: string, triggerMessageId: string) {
  publishChatEvent({ type: "ai_thinking", roomId, agentKey, agentName, triggerMessageId });
}

export function publishAiDone(roomId: string, agentKey: string, triggerMessageId: string, ok: boolean, error?: string) {
  publishChatEvent({ type: "ai_done", roomId, agentKey, triggerMessageId, ok, error });
}
