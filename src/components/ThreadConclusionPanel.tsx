"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
type Props = { roomId: string; threadId: string };
type Conclusion = { summary: string; sources: string[]; model?: string };
export default function ThreadConclusionPanel({ roomId, threadId }: Props) {
  const [summary, setSummary] = useState(""); const [sources, setSources] = useState(""); const [model, setModel] = useState(""); const [saved, setSaved] = useState(false); const [error, setError] = useState("");
  useEffect(() => { void api<{ conclusions: Conclusion[] }>(`/api/rooms/${roomId}/threads/${threadId}/conclusion`).then((r) => { const c = r.conclusions[0]; if (c) { setSummary(c.summary); setSources(c.sources.join("\n")); setModel(c.model ?? ""); } }).catch(() => undefined); }, [roomId, threadId]);
  async function save() { setSaved(false); setError(""); try { await api(`/api/rooms/${roomId}/threads/${threadId}/conclusion`, { method: "POST", body: JSON.stringify({ summary, sources: sources.split("\n").filter(Boolean), model, confirmed: true }) }); setSaved(true); } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); } }
  return <section aria-label="Thread 结论"><h3>Thread 结论</h3><textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="输入结论摘要" /><input value={model} onChange={(e) => setModel(e.target.value)} placeholder="模型信息（可选）" /><textarea value={sources} onChange={(e) => setSources(e.target.value)} placeholder="来源链接，每行一个" /><button type="button" onClick={() => void save()} disabled={!summary.trim()}>确认并保存</button>{saved && <span>已保存</span>}{error && <span role="alert">{error}</span>}</section>;
}
