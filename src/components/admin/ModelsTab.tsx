"use client";

import { HeartPulse, LoaderCircle, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/components/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Pagination } from "./Pagination";

type ProviderType = "OPENAI_COMPATIBLE" | "OPENAI_IMAGES" | "GEMINI_IMAGES" | "CUSTOM";
type Model = { id: string; name: string; modelId: string; baseUrl: string; providerType: ProviderType; timeoutMs: number; enabled: boolean; hasApiKey: boolean; agentCount?: number };
type Draft = { id?: string; name: string; modelId: string; baseUrl: string; providerType: ProviderType; apiKey: string; timeoutMs: number; enabled: boolean };
const EMPTY: Draft = { name: "", modelId: "", baseUrl: "http://localhost:4000/v1", providerType: "OPENAI_COMPATIBLE", apiKey: "", timeoutMs: 30000, enabled: true };
const PROVIDER_LABELS: Record<ProviderType, string> = { OPENAI_COMPATIBLE: "OpenAI 兼容", OPENAI_IMAGES: "OpenAI 图片", GEMINI_IMAGES: "Gemini 图片", CUSTOM: "自定义" };
const PROVIDER_DEFAULTS: Record<ProviderType, Pick<Draft, "baseUrl" | "modelId">> = {
  OPENAI_COMPATIBLE: { baseUrl: "http://localhost:4000/v1", modelId: "local-model" },
  OPENAI_IMAGES: { baseUrl: "https://api.openai.com/v1", modelId: "gpt-image-1" },
  GEMINI_IMAGES: { baseUrl: "https://generativelanguage.googleapis.com/v1beta", modelId: "gemini-2.5-flash-image" },
  CUSTOM: { baseUrl: "http://localhost:4000/v1", modelId: "custom-model" },
};

export default function ModelsTab() {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [health, setHealth] = useState<Record<string, "checking" | "ok" | "error">>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  async function refresh() {
    const { models } = await api<{ models: Model[] }>("/api/admin/models");
    setModels(models ?? []);
  }
  useEffect(() => {
    api<{ models: Model[] }>("/api/admin/models").then((p) => setModels(p.models ?? [])).finally(() => setLoading(false));
  }, []);

  function openEdit(m: Model) {
    setDraft({ id: m.id, name: m.name, modelId: m.modelId, baseUrl: m.baseUrl, providerType: m.providerType, apiKey: "", timeoutMs: m.timeoutMs, enabled: m.enabled });
  }
  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { ...draft, id: draft.id || undefined };
      if (!draft.apiKey) delete payload.apiKey;
      await api("/api/admin/models", { method: draft.id ? "PUT" : "POST", body: JSON.stringify(payload) });
      await refresh();
      setDraft(null);
    } finally {
      setSaving(false);
    }
  }
  async function toggle(m: Model) {
    await api("/api/admin/models", { method: "PUT", body: JSON.stringify({ id: m.id, name: m.name, modelId: m.modelId, baseUrl: m.baseUrl, providerType: m.providerType, timeoutMs: m.timeoutMs, enabled: !m.enabled }) });
    refresh();
  }
  async function remove(id: string) {
    if (!window.confirm("确认删除该模型？绑定它的 Agent 将失去模型。")) return;
    try { await api(`/api/admin/models?id=${id}`, { method: "DELETE" }); refresh(); } catch { /* ignore */ }
  }
  async function checkHealth(m: Model) {
    setHealth((c) => ({ ...c, [m.id]: "checking" }));
    try {
      await api(`/api/admin/models/${m.id}/health`, { method: "POST" });
      setHealth((c) => ({ ...c, [m.id]: "ok" }));
    } catch {
      setHealth((c) => ({ ...c, [m.id]: "error" }));
    }
  }

  if (loading) return <p className="py-6 text-sm text-muted-foreground">加载模型中…</p>;

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">模型配置</h2>
          <p className="mt-1 text-xs text-muted-foreground">配置多个模型；多个 Agent 可以共用同一个模型，停用后创建 Agent 时不可选。</p>
        </div>
        <Button size="sm" onClick={() => setDraft({ ...EMPTY })}><Plus className="h-4 w-4" /> 新建模型</Button>
      </div>
      <div className="admin-list-scroll mt-4">
        <table className="admin-model-table w-full text-sm">
          <colgroup><col className="model-col-name" /><col className="model-col-id" /><col className="model-col-provider" /><col className="model-col-url" /><col className="model-col-key" /><col className="model-col-status" /><col className="model-col-health" /><col className="model-col-actions" /></colgroup>
          <thead>
            <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-4 font-medium">名称</th>
              <th className="py-2 pr-4 font-medium">模型 ID</th>
              <th className="py-2 pr-4 font-medium">提供方</th>
              <th className="py-2 pr-4 font-medium">接口地址</th>
              <th className="py-2 pr-4 font-medium">密钥</th>
              <th className="py-2 pr-4 font-medium">状态</th>
              <th className="py-2 pr-4 font-medium">健康</th>
              <th className="py-2 pr-4 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {models.slice((page - 1) * pageSize, page * pageSize).map((m) => (
              <tr key={m.id} className="border-b last:border-0 hover:bg-muted/40">
                <td className="py-2.5 pr-4 font-medium"><span className="admin-cell-ellipsis" title={m.name}>{m.name}</span></td>
                <td className="py-2.5 pr-4 text-muted-foreground"><span className="admin-cell-ellipsis" title={m.modelId}>{m.modelId}</span></td>
                <td className="py-2.5 pr-4"><Badge variant="outline">{PROVIDER_LABELS[m.providerType]}</Badge></td>
                <td className="py-2.5 pr-4 text-muted-foreground"><span className="admin-cell-ellipsis" title={m.baseUrl}>{m.baseUrl}</span></td>
                <td className="py-2.5 pr-4 text-muted-foreground">{m.hasApiKey ? "已配置" : "—"}</td>
                <td className="py-2.5 pr-4"><Badge variant={m.enabled ? "success" : "destructive"}>{m.enabled ? "启用" : "停用"}</Badge></td>
                <td className="py-2.5 pr-4">
                  {health[m.id] === "ok" && <Badge variant="success">正常</Badge>}
                  {health[m.id] === "error" && <Badge variant="destructive">异常</Badge>}
                  {health[m.id] === "checking" && <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" />}
                </td>
                <td className="py-2.5 pr-4 text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="icon" className="admin-icon-button" data-tooltip="编辑" onClick={() => openEdit(m)} aria-label={`编辑 ${m.name}`} title="编辑"><Pencil /></Button>
                    <Button variant="outline" size="icon" className="admin-icon-button" data-tooltip="健康检查" onClick={() => checkHealth(m)} disabled={health[m.id] === "checking"} aria-label={`检查 ${m.name}`} title="健康检查"><HeartPulse /></Button>
                    <Button variant="outline" size="icon" className="admin-icon-button" data-tooltip={m.enabled ? "停用" : "启用"} onClick={() => toggle(m)} aria-label={m.enabled ? `停用 ${m.name}` : `启用 ${m.name}`} title={m.enabled ? "停用" : "启用"}><Power /></Button>
                    <Button variant="destructive" size="icon" className="admin-icon-button" data-tooltip="删除" onClick={() => remove(m.id)} aria-label={`删除 ${m.name}`} title="删除"><Trash2 /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={pageSize} total={models.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />

      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "编辑模型" : "新建模型"}</DialogTitle>
            <DialogDescription>实际发送给网关的模型名用于区分不同的服务后端。</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2"><Label>显示名称</Label><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
                <div className="grid gap-2"><Label>模型 ID</Label><Input value={draft.modelId} onChange={(e) => setDraft({ ...draft, modelId: e.target.value })} /></div>
              </div>
              <div className="grid gap-2"><Label>提供方类型</Label><Select value={draft.providerType} onValueChange={(value) => { const providerType = value as ProviderType; setDraft({ ...draft, providerType, ...PROVIDER_DEFAULTS[providerType] }); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(PROVIDER_LABELS) as ProviderType[]).map((providerType) => <SelectItem key={providerType} value={providerType}>{PROVIDER_LABELS[providerType]}（{providerType}）</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-2"><Label>接口地址</Label><Input value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2"><Label>超时（毫秒）</Label><Input type="number" min={1000} max={120000} value={draft.timeoutMs} onChange={(e) => setDraft({ ...draft, timeoutMs: Number(e.target.value) })} /></div>
                <div className="grid gap-2"><Label>密钥{draft.id ? "（留空保留原值）" : ""}</Label><Input type="password" value={draft.apiKey} onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })} placeholder={draft.providerType === "GEMINI_IMAGES" ? "Google AI Studio API Key（必填）" : "可选 API 密钥"} autoComplete="new-password" /></div>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div><p className="text-sm font-medium">启用</p><p className="text-xs text-muted-foreground">停用后创建 Agent 时该模型不可选。</p></div>
                <Switch checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>取消</Button>
            <Button onClick={save} disabled={saving}>{saving && <LoaderCircle className="h-4 w-4 animate-spin" />} 保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
