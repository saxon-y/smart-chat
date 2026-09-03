"use client";
import { Bookmark, Pin, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, Message } from "./api";
export type MarkerPanelProps = { roomId: string; open: boolean; onClose: () => void; onSelectMessage?: (message: Message) => void };
type Marker = { message: Message; deletedAt?: string | null };
export default function MarkerPanel({ roomId, open, onClose, onSelectMessage }: MarkerPanelProps) {
  const [pins, setPins] = useState<Marker[]>([]); const [bookmarks, setBookmarks] = useState<Marker[]>([]); const [tab, setTab] = useState<"pins" | "bookmarks">("pins");
  useEffect(() => { if (!open) return; void api<{ pins: Marker[]; bookmarks: Marker[] }>(`/api/rooms/${encodeURIComponent(roomId)}/markers`).then((r) => { setPins(r.pins); setBookmarks(r.bookmarks); }).catch(() => undefined); }, [open, roomId]);
  if (!open) return null; const list = tab === "pins" ? pins : bookmarks;
  return <aside className="marker-panel" role="dialog" aria-label="置顶与收藏"><header><h2>置顶与收藏</h2><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={16} /></button></header><nav><button className={tab === "pins" ? "active" : ""} onClick={() => setTab("pins")}><Pin size={14} /> 置顶</button><button className={tab === "bookmarks" ? "active" : ""} onClick={() => setTab("bookmarks")}><Bookmark size={14} /> 收藏</button></nav><div>{list.length === 0 ? <p>暂无内容</p> : list.map((item) => <button key={item.message.id} onClick={() => onSelectMessage?.(item.message)}><strong>{item.message.senderName ?? "未知"}</strong><span>{item.message.body}</span></button>)}</div></aside>;
}
