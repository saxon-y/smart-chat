"use client";

import { Bell, Check, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, formatTime } from "./api";

export type NotificationItem = { id: string; roomId?: string | null; type: string; title: string; summary: string; sourceId?: string | null; sourceType?: string | null; readAt?: string | null; createdAt: string };

export default function NotificationPanel({ onNavigate }: { onNavigate?: (notification: NotificationItem) => void }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const result = await api<{ notifications: NotificationItem[] }>("/api/notifications"); setItems(result.notifications); } finally { setLoading(false); }
  }, []);
  // Fetch on mount; the API response drives the panel state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function mark(ids?: string[]) {
    setBusy(true);
    try { await api("/api/notifications", { method: "PATCH", body: JSON.stringify(ids ? { ids } : {}) }); setItems((current) => ids ? current.map((item) => ids.includes(item.id) ? { ...item, readAt: new Date().toISOString() } : item) : current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() }))); } finally { setBusy(false); }
  }

  return <section aria-label="通知中心" className="notification-panel">
    <header className="notification-panel-header"><div><h2>通知</h2><p>提及、回复、审批和 Agent 结果</p></div><button type="button" onClick={() => void mark()} disabled={busy || !items.some((item) => !item.readAt)} title="全部标记为已读"><Check size={15} /></button></header>
    {loading ? <div className="notification-state"><LoaderCircle size={15} className="spin" /> 加载中…</div> : items.length === 0 ? <div className="notification-state"><Bell size={15} /> 暂无通知</div> : <div className="notification-list">{items.map((item) => <button type="button" key={item.id} className={`notification-item${item.readAt ? " read" : ""}`} onClick={() => { onNavigate?.(item); if (!item.readAt) void mark([item.id]); }}><span className="notification-item-copy"><strong>{item.title}</strong><span>{item.summary}</span><time>{formatTime(item.createdAt)}</time></span>{!item.readAt && <i aria-label="未读" />}</button>)}</div>}
  </section>;
}
