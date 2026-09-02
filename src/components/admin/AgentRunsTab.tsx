"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronLeft, ChevronRight, RefreshCw, X } from "lucide-react";
import { api } from "@/components/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Run = {
  id: string; roomId: string; status: string; mode: string; attempt: number; latencyMs?: number | null; errorCode?: string | null;
  blockedReason?: string | null; createdAt: string; parentRunId?: string | null; runtimeKind?: string | null;
  runtimeVersion?: string | null; inputTokens: number; outputTokens: number; costMicros: number; toolCallCount: number;
  checkpointSequence: number; targetAgent?: { name: string; kind: string } | null;
  runtime?: { id: string; kind: string; status: string; version?: string | null } | null;
  latestTurn?: { turnIndex: number; status: string; thinkingContinuity: string; finishReason?: string | null } | null;
  latestCheckpoint?: { eventSequence: number; turnIndex: number; contextGeneration: number } | null;
  toolsByStatus: Record<string, number>; approvalsByStatus: Record<string, number>;
  pendingApprovals: Approval[];
  childRuns: { id: string; status: string; targetAgent?: { name: string } | null }[];
  _count: { runEvents: number; runTurns: number; runCheckpoints: number; artifacts: number; childRuns: number };
};
type Approval = {
  id: string; toolCallId: string; argumentsDigest: string; status: string;
  requestedAt: string; decidedAt?: string | null; decidedBy?: string | null; decisionReason?: string | null;
  toolCall: { toolId: string; toolVersion: string; risk: string; status: string };
};
type Payload = { items: Run[]; nextCursor: string | null; metrics: { total: number; byStatus: Record<string, number>; byMode: Record<string, number> } };

export default function AgentRunsTab() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<(string | null)[]>([]);
  const [approvalBusy, setApprovalBusy] = useState<string | null>(null);
  const load = useCallback((nextCursor: string | null) => {
    setLoading(true);
    const query = nextCursor ? `?limit=20&cursor=${encodeURIComponent(nextCursor)}` : "?limit=20";
    api<Payload>(`/api/admin/agent-runs${query}`).then(setPayload).finally(() => setLoading(false));
  }, []);
  useEffect(() => { api<Payload>("/api/admin/agent-runs?limit=20").then(setPayload).finally(() => setLoading(false)); }, []);
  const status = payload?.metrics.byStatus ?? {};
  const next = () => { if (payload?.nextCursor) { const target = payload.nextCursor; setHistory((value) => [...value, cursor]); setCursor(target); load(target); } };
  const previous = () => { const prior = history.at(-1) ?? null; setHistory((value) => value.slice(0, -1)); setCursor(prior); load(prior); };
  const decideApproval = async (run: Run, approval: Approval, decision: "APPROVED" | "REJECTED") => {
    setApprovalBusy(approval.id);
    try {
      await api(`/api/rooms/${encodeURIComponent(run.roomId)}/runs/${encodeURIComponent(run.id)}/approvals/${encodeURIComponent(approval.id)}`, {
        method: "POST", body: JSON.stringify({ decision }),
      });
      load(cursor);
    } finally { setApprovalBusy(null); }
  };
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between gap-4">
        <div><h2 className="text-base font-semibold">Agent 运行</h2><p className="mt-1 text-xs text-muted-foreground">Runtime、Turn、工具与审批审计；敏感参数和消息正文不会返回。</p></div>
        <Button variant="outline" size="icon" className="admin-icon-button" data-tooltip="刷新运行记录" onClick={() => load(cursor)} disabled={loading} aria-label="刷新运行记录" title="刷新运行记录"><RefreshCw className={`h-4 w-4${loading ? " animate-spin" : ""}`} /></Button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["总任务", payload?.metrics.total ?? 0], ["成功", status.succeeded ?? 0], ["处理中", (status.pending ?? 0) + (status.claimed ?? 0) + (status.running ?? 0)], ["失败", (status.failed_final ?? 0) + (status.failed_retryable ?? 0)]].map(([label, value]) => <div className="rounded-md border p-3" key={String(label)}><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-xl font-semibold">{value}</div></div>)}
      </div>
      <div className="admin-list-scroll mt-4">
        <table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2">时间 / Agent</th><th>Runtime</th><th>状态</th><th>Turn / 连续性</th><th>工具 / 审批</th><th>Usage</th><th>DAG / 记录</th></tr></thead>
          <tbody>{payload?.items.map((run) => <tr className="border-b align-top last:border-0" key={run.id}>
            <td className="py-2.5"><div>{run.targetAgent?.name ?? "房间总管"}</div><div className="text-xs text-muted-foreground">{new Date(run.createdAt).toLocaleString("zh-CN")}</div></td>
            <td><div>{run.runtime?.kind ?? run.runtimeKind ?? run.mode}</div><div className="text-xs text-muted-foreground">{run.runtime?.version ?? run.runtimeVersion ?? "-"}</div></td>
            <td><Badge variant={run.status === "succeeded" || run.status === "no_action" ? "success" : run.status.startsWith("failed") ? "destructive" : "secondary"}>{run.status}</Badge><div className="mt-1 text-xs text-destructive">{run.errorCode ?? run.blockedReason ?? ""}</div></td>
            <td><div>{run._count.runTurns} turns</div><div className="text-xs text-muted-foreground">{run.latestTurn?.thinkingContinuity ?? "NONE"} · cp {run.checkpointSequence}</div></td>
            <td>
              <div>{run.toolCallCount} tools</div>
              <div className="text-xs text-muted-foreground">待审批 {run.approvalsByStatus.pending ?? 0} · 失败 {run.toolsByStatus.failed ?? 0}</div>
              {run.pendingApprovals.length > 0 && <div className="mt-2 space-y-1.5">
                {run.pendingApprovals.map((approval) => <div className="flex items-center gap-1.5" key={approval.id}>
                  <span className="max-w-28 truncate text-xs" title={`${approval.toolCall.toolId}@${approval.toolCall.toolVersion}`}>{approval.toolCall.toolId}</span>
                  <Button size="icon" className="admin-icon-button h-7 w-7" data-tooltip="批准工具调用" title="批准工具调用" aria-label="批准工具调用" disabled={approvalBusy === approval.id} onClick={() => decideApproval(run, approval, "APPROVED")}><Check className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="outline" className="admin-icon-button h-7 w-7" data-tooltip="拒绝工具调用" title="拒绝工具调用" aria-label="拒绝工具调用" disabled={approvalBusy === approval.id} onClick={() => decideApproval(run, approval, "REJECTED")}><X className="h-3.5 w-3.5" /></Button>
                </div>)}
              </div>}
            </td>
            <td><div>{run.inputTokens + run.outputTokens} tokens</div><div className="text-xs text-muted-foreground">{run.costMicros} μ</div></td>
            <td><div>{run.parentRunId ? "子 Run" : `父 Run · ${run._count.childRuns} 子项`}</div><div className="text-xs text-muted-foreground">{run._count.runEvents} events · {run._count.artifacts} artifacts</div></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="admin-pagination"><span className="admin-pagination-summary">第 {history.length + 1} 页 · 共 {payload?.metrics.total ?? 0} 条</span><div className="admin-pagination-actions"><button type="button" className="admin-page-button" aria-label="上一页" title="上一页" disabled={!history.length || loading} onClick={previous}><ChevronLeft className="h-4 w-4" /></button><button type="button" className="admin-page-button" aria-label="下一页" title="下一页" disabled={!payload?.nextCursor || loading} onClick={next}><ChevronRight className="h-4 w-4" /></button></div></div>
    </div>
  );
}
