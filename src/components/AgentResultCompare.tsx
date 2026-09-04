"use client";
import { Check, Undo2 } from "lucide-react";
import { useState } from "react";
export type AgentResult = { id: string; agentName: string; modelName?: string | null; body?: string | null; status?: string; sourceLabel?: string };
export function AgentResultCompare({ results, onAdopt }: { results: AgentResult[]; onAdopt?: (id: string | null) => void }) {
  const [adopted, setAdopted] = useState<string | null>(null);
  const adopt = (id: string) => { const next = adopted === id ? null : id; setAdopted(next); onAdopt?.(next); };
  return <section aria-label="Agent 结果比较" className="grid gap-3 sm:grid-cols-2">{results.map((result) => <article key={result.id} className="border border-slate-200 bg-white p-3"><header className="flex items-start justify-between gap-2"><div><strong className="block text-sm">{result.agentName}</strong><span className="text-xs text-slate-500">{result.modelName ?? result.sourceLabel ?? "Agent 结果"}</span></div><button type="button" onClick={() => adopt(result.id)} aria-pressed={adopted === result.id} className="inline-flex items-center gap-1 border px-2 py-1 text-xs">{adopted === result.id ? <><Undo2 size={13} />撤销采用</> : <><Check size={13} />采用</>}</button></header><div className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-sm text-slate-700">{result.body || (result.status ? `状态：${result.status}` : "暂无结果")}</div></article>)}</section>;
}
export default AgentResultCompare;
