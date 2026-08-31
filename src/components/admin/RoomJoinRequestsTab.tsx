"use client";

import { Check, LoaderCircle, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/components/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "./Pagination";

type Request = { id: string; status: string; reason?: string | null; createdAt: string; user?: { displayName?: string; email?: string } | null; room?: { name?: string; slug?: string; id?: string } | null };

export default function RoomJoinRequestsTab() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [status, setStatus] = useState("PENDING");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    let active = true;
    api<{ requests?: Request[] }>(`/api/admin/room-join-requests?status=${status}`)
      .then((response) => { if (active) setRequests(response.requests ?? []); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [status]);
  const visible = useMemo(() => requests.slice((page - 1) * pageSize, page * pageSize), [requests, page, pageSize]);
  async function review(id: string, action: "approve" | "reject") { setBusy(id); try { await api(`/api/admin/room-join-requests/${id}/${action}`, { method: "POST" }); setRequests((v) => v.map((r) => r.id === id ? { ...r, status: action === "approve" ? "APPROVED" : "REJECTED" } : r)); } finally { setBusy(null); } }

  return <div className="rounded-xl border bg-card p-5">
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold">入群申请</h2><p className="mt-1 text-xs text-muted-foreground">审核用户加入聊天室的申请。</p></div><div className="flex gap-1">{["PENDING", "APPROVED", "REJECTED"].map((s) => <button key={s} type="button" className={`rounded-md px-2.5 py-1 text-xs ${status === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`} onClick={() => { setLoading(true); setStatus(s); setPage(1); }}>{s === "PENDING" ? "待审核" : s === "APPROVED" ? "已通过" : "已拒绝"}</button>)}</div></div>
    <div className="admin-list-scroll mt-4">{loading ? <div className="flex h-32 items-center justify-center text-sm text-muted-foreground"><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />加载中</div> : <table className="w-full text-sm"><thead><tr><th>申请人</th><th>聊天室</th><th>申请理由</th><th>申请时间</th><th>状态</th><th className="text-right">操作</th></tr></thead><tbody>{visible.map((r) => <tr key={r.id}><td>{r.user?.displayName ?? r.user?.email ?? "未知用户"}</td><td>{r.room?.name ?? r.room?.slug ?? r.room?.id ?? "未知聊天室"}</td><td className="max-w-xs truncate text-muted-foreground">{r.reason || "-"}</td><td>{new Date(r.createdAt).toLocaleString("zh-CN")}</td><td><Badge variant={r.status === "APPROVED" ? "success" : r.status === "REJECTED" ? "destructive" : "outline"}>{r.status === "PENDING" ? "待审核" : r.status === "APPROVED" ? "已通过" : "已拒绝"}</Badge></td><td className="text-right">{r.status === "PENDING" && <span className="inline-flex gap-1"><Button size="icon" className="admin-icon-button" data-tooltip="通过申请" title="通过申请" aria-label="通过申请" disabled={busy === r.id} onClick={() => review(r.id, "approve")}><Check /></Button><Button size="icon" variant="outline" className="admin-icon-button" data-tooltip="拒绝申请" title="拒绝申请" aria-label="拒绝申请" disabled={busy === r.id} onClick={() => review(r.id, "reject")}><X /></Button></span>}</td></tr>)}</tbody></table>}</div>
    <Pagination page={page} pageSize={pageSize} total={requests.length} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} />
  </div>;
}
