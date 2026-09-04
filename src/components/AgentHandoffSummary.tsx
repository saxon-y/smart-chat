"use client";
import { ArrowRight, CircleAlert } from "lucide-react";
export type HandoffSource = { id: string; agentName: string; status: string; summary?: string | null };
export function AgentHandoffSummary({ sources, summary, partial = false }: { sources: HandoffSource[]; summary?: string | null; partial?: boolean }) {
  return <section aria-label="Agent 汇总" className="border border-slate-200 bg-white p-3"><div className="flex items-center gap-2 text-sm font-semibold"><ArrowRight size={15} />{partial ? "部分结果汇总" : "Agent 汇总"}</div><div className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{summary || "正在等待各 Agent 返回结果…"}</div><div className="mt-3 flex flex-wrap gap-2">{sources.map((source) => <span key={source.id} className="inline-flex items-center gap-1 border px-2 py-1 text-xs text-slate-600">{source.status === "SUCCEEDED" ? "✓" : <CircleAlert size={12} />}{source.agentName}</span>)}</div></section>;
}
export default AgentHandoffSummary;
