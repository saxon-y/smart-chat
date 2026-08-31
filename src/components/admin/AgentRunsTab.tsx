"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "@/components/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pagination } from "./Pagination";

type Run = { id: string; status: string; mode: string; attempt: number; latencyMs?: number | null; errorCode?: string | null; createdAt: string; targetAgent?: { name: string; kind: string } | null };
type Payload = { items: Run[]; metrics: { total: number; byStatus: Record<string, number>; byMode: Record<string, number> } };

export default function AgentRunsTab() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const load = () => { setLoading(true); api<Payload>(`/api/admin/agent-runs?limit=100`).then((next) => { setPayload(next); setPage(1); }).finally(() => setLoading(false)); };
  useEffect(() => { api<Payload>("/api/admin/agent-runs?limit=100").then(setPayload).finally(() => setLoading(false)); }, []);
  const status = payload?.metrics.byStatus ?? {};
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between gap-4">
        <div><h2 className="text-base font-semibold">Agent 运行</h2><p className="mt-1 text-xs text-muted-foreground">路由、执行、耗时与失败状态，不展示消息正文和密钥。</p></div>
        <Button variant="outline" size="icon" className="admin-icon-button" data-tooltip="刷新运行记录" onClick={load} disabled={loading} aria-label="刷新运行记录" title="刷新运行记录"><RefreshCw className={`h-4 w-4${loading ? " animate-spin" : ""}`} /></Button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[['总任务', payload?.metrics.total ?? 0], ['成功', status.succeeded ?? 0], ['处理中', (status.pending ?? 0) + (status.claimed ?? 0) + (status.running ?? 0)], ['失败', (status.failed_final ?? 0) + (status.failed_retryable ?? 0)]].map(([label, value]) => <div className="rounded-md border p-3" key={String(label)}><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-xl font-semibold">{value}</div></div>)}
      </div>
      <div className="admin-list-scroll mt-4">
        <table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2">时间</th><th>Agent</th><th>模式</th><th>状态</th><th>尝试</th><th>耗时</th><th>错误</th></tr></thead>
          <tbody>{payload?.items.slice((page - 1) * pageSize, page * pageSize).map((run) => <tr className="border-b last:border-0" key={run.id}><td className="py-2.5 text-muted-foreground">{new Date(run.createdAt).toLocaleString("zh-CN")}</td><td>{run.targetAgent?.name ?? "房间总管"}</td><td>{run.mode}</td><td><Badge variant={run.status === "succeeded" || run.status === "no_action" ? "success" : run.status.startsWith("failed") ? "destructive" : "secondary"}>{run.status}</Badge></td><td>{run.attempt}</td><td>{run.latencyMs ? `${run.latencyMs} ms` : "-"}</td><td className="text-xs text-destructive">{run.errorCode ?? "-"}</td></tr>)}</tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={pageSize} total={payload?.items.length ?? 0} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
    </div>
  );
}
