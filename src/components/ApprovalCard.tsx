"use client";

import { Check, CircleAlert, LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import { presentApproval, type ApprovalPresentationInput } from "@/lib/harness/approvals/presentation";

export type ApprovalCardProps = ApprovalPresentationInput & {
  approvalId: string;
  roomId: string;
  runId: string;
  onDecided?: (decision: "APPROVED" | "REJECTED") => void;
};

export function ApprovalCard({ approvalId, roomId, runId, onDecided, ...input }: ApprovalCardProps) {
  const summary = presentApproval(input);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const decided = String(input.status ?? "PENDING").toUpperCase() !== "PENDING";

  async function decide(decision: "APPROVED" | "REJECTED") {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ decision, ...(reason.trim() ? { reason: reason.trim().slice(0, 500) } : {}) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error?.message ?? payload?.message ?? "审批未完成，请稍后重试。");
      onDecided?.(decision);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "审批未完成，请稍后重试。");
    } finally { setBusy(false); }
  }

  return (
    <section className="border border-amber-200 bg-amber-50/60 p-3 text-sm text-slate-800" aria-label="工具审批">
      <div className="flex items-start gap-2"><CircleAlert size={16} className="mt-0.5 text-amber-700" aria-hidden="true" /><div className="min-w-0 flex-1"><strong className="block">需要确认：{summary.toolLabel}</strong><span className="text-xs text-slate-600">{summary.riskLabel}{summary.targetLabel ? ` · 目标：${summary.targetLabel}` : ""}</span></div><span className="text-xs text-amber-800">{summary.statusLabel}</span></div>
      {!decided && <><label className="mt-2 block text-xs text-slate-600" htmlFor={`approval-reason-${approvalId}`}>备注（可选）</label><textarea id={`approval-reason-${approvalId}`} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} rows={2} disabled={busy} className="mt-1 w-full resize-none border border-amber-200 bg-white p-2 text-xs" placeholder="留下审批原因" />
        <div className="mt-2 flex gap-2"><button type="button" disabled={busy} onClick={() => void decide("APPROVED")} className="inline-flex items-center gap-1 border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-800"><Check size={13} />批准</button><button type="button" disabled={busy} onClick={() => void decide("REJECTED")} className="inline-flex items-center gap-1 border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"><X size={13} />拒绝</button>{busy && <LoaderCircle size={14} className="animate-spin self-center text-slate-500" aria-label="提交中" />}</div></>}
      {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    </section>
  );
}

export default ApprovalCard;
