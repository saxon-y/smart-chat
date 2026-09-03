"use client";

import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, formatTime, Message } from "./api";

export type SearchPanelProps = { roomId: string; open: boolean; onClose: () => void; onSelectMessage?: (message: Message) => void };
type Result = { messages: Message[]; page: number; total: number; hasMore: boolean };

export default function SearchPanel({ roomId, open, onClose, onSelectMessage }: SearchPanelProps) {
  const [q, setQ] = useState(""); const [sender, setSender] = useState(""); const [kind, setKind] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [result, setResult] = useState<Result | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  useEffect(() => { if (open) window.setTimeout(() => document.getElementById("message-search-input")?.focus(), 50); }, [open]);
  async function runSearch(page = 1) { setLoading(true); setError(""); try { const params = new URLSearchParams({ page: String(page), limit: "30" }); if (q.trim()) params.set("q", q.trim()); if (sender) params.set("sender", sender); if (kind) params.set("type", kind); if (from) params.set("from", from); if (to) params.set("to", to); setResult(await api<Result>(`/api/rooms/${encodeURIComponent(roomId)}/messages/search?${params}`)); } catch (e) { setError(e instanceof Error ? e.message : "搜索失败"); } finally { setLoading(false); } }
  if (!open) return null;
  return <aside className="search-panel" role="dialog" aria-label="搜索消息">
    <header><h2>搜索消息</h2><button type="button" className="icon-button" onClick={onClose} aria-label="关闭搜索"><X size={16} /></button></header>
    <form onSubmit={(e) => { e.preventDefault(); void runSearch(); }}>
      <div className="search-input"><Search size={15} /><input id="message-search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索消息内容" /></div>
      <input value={sender} onChange={(e) => setSender(e.target.value)} placeholder="发送者成员 ID（可选）" />
      <div className="search-row"><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">所有类型</option><option value="TEXT">文本</option><option value="AI">AI</option><option value="SYSTEM">系统</option></select><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      <button className="primary-button" type="submit" disabled={loading}>{loading ? "搜索中…" : "搜索"}</button>
    </form>
    {error && <p role="alert" className="search-error">{error}</p>}
    <div className="search-results">{result && <div className="search-summary">找到 {result.total} 条消息</div>}{result?.messages.map((message) => <button className="search-result" key={message.id} onClick={() => onSelectMessage?.(message)}><strong>{message.senderName ?? "未知"}</strong><time>{formatTime(message.createdAt)}</time><p>{message.body}</p></button>)}{result && result.hasMore && <button className="secondary-button" onClick={() => void runSearch(result.page + 1)}>下一页</button>}</div>
  </aside>;
}
