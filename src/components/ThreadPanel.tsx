"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, Send, X } from "lucide-react";
import { api, formatTime, initials, Message, uuid } from "./api";
import ThreadConclusionPanel from "./ThreadConclusionPanel";

export type ThreadPanelProps = {
  roomId: string;
  rootMessage: Message | null;
  open: boolean;
  onClose: () => void;
  currentMemberId?: string;
  currentMemberName?: string;
};

type ThreadRecord = { id: string; lastSequence: number };
type ThreadPayload = { thread: ThreadRecord; replies: Message[]; nextCursor: number };

function messageText(message: Message) {
  return message.body || (message.contentParts?.length ? "[图片]" : "");
}

export default function ThreadPanel({
  roomId,
  rootMessage,
  open,
  onClose,
  currentMemberId,
  currentMemberName = "我",
}: ThreadPanelProps) {
  const [replies, setReplies] = useState<Message[]>([]);
  const [thread, setThread] = useState<ThreadRecord | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadThread = useCallback(async () => {
    if (!rootMessage) return;
    setLoading(true);
    setError("");
    try {
      const created = await api<{ thread: ThreadRecord }>(`/api/rooms/${encodeURIComponent(roomId)}/threads`, {
        method: "POST",
        body: JSON.stringify({ rootMessageId: rootMessage.id }),
      });
      setThread(created.thread);
      const payload = await api<ThreadPayload>(`/api/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(created.thread.id)}`);
      setReplies(payload.replies);
      if (payload.nextCursor > 0) {
        await api(`/api/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(created.thread.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ lastSequence: payload.nextCursor }),
        });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法加载讨论");
    } finally {
      setLoading(false);
    }
  }, [roomId, rootMessage]);

  useEffect(() => {
    if (!open || !thread) return;
    const source = new EventSource(`/api/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(thread.id)}/events`);
    source.onmessage = (event) => {
      const payload = JSON.parse(event.data) as { type?: string; reply?: Message };
      if (payload.type !== "thread_reply" || !payload.reply) return;
      setReplies((current) => current.some((item) => item.id === payload.reply?.id) ? current : [...current, payload.reply as Message]);
    };
    return () => source.close();
  }, [open, roomId, thread]);

  useEffect(() => {
    if (!open || !rootMessage) return;
    const loadTimer = window.setTimeout(() => void loadThread(), 0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => {
      window.clearTimeout(loadTimer);
      window.clearTimeout(timer);
    };
  }, [open, rootMessage, loadThread]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  async function submitReply() {
    const body = draft.trim();
    if (!body || !thread || sending) return;
    setSending(true);
    setError("");
    try {
      const payload = await api<{ reply: Message }>(
        `/api/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(thread.id)}`,
        { method: "POST", body: JSON.stringify({ body, clientId: uuid() }) },
      );
      setReplies((current) => current.some((item) => item.id === payload.reply.id) ? current : [...current, payload.reply]);
      setDraft("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "回复发送失败");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  if (!open || !rootMessage) return null;
  return (
    <aside className="thread-panel" aria-label="消息讨论" role="dialog" aria-modal="false">
      <header className="thread-header">
        <div>
          <h2>讨论</h2>
          <span>{replies.length} 条回复</span>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="关闭讨论" title="关闭讨论">
          <X size={16} />
        </button>
      </header>
      <div className="thread-scroll">
        <section className="thread-root">
          <div className="thread-label">原消息</div>
          <div className="thread-message-author"><span className="thread-avatar">{initials(rootMessage.senderName)}</span><strong>{rootMessage.senderName ?? "未知"}</strong><time>{formatTime(rootMessage.createdAt)}</time></div>
          <p>{messageText(rootMessage)}</p>
        </section>
        <div className="thread-replies" aria-live="polite">
          {loading && <div className="thread-state"><LoaderCircle size={14} className="spin" /> 正在加载…</div>}
          {!loading && replies.length === 0 && <div className="thread-state">还没有回复</div>}
          {replies.map((reply) => <article className={`thread-reply${reply.senderMemberId === currentMemberId ? " own" : ""}`} key={reply.id}>
            <span className="thread-avatar">{initials(reply.senderName)}</span>
            <div><div className="thread-message-author"><strong>{reply.senderName ?? "未知"}</strong><time>{formatTime(reply.createdAt)}</time></div><p>{messageText(reply)}</p></div>
          </article>)}
        </div>
      </div>
      <div className="thread-composer">
        {error && <div className="thread-error" role="alert">{error}</div>}
        <textarea ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submitReply(); } }} placeholder={`回复 ${rootMessage.senderName ?? currentMemberName}…`} rows={2} disabled={sending} />
        <button type="button" className="send-button" onClick={() => void submitReply()} disabled={!draft.trim() || sending} aria-label="发送回复"><Send size={14} /> 回复</button>
      </div>
      <ThreadConclusionPanel roomId={roomId} threadId={rootMessage.id} />
    </aside>
  );
}
