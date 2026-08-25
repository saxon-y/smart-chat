"use client";

import { LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/components/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PERSONAS } from "@/lib/ai/personas";
import { AGENT_AVATARS, AGENT_COLORS, DEFAULT_AGENT_AVATAR } from "@/lib/ai/avatars";

type Model = { id: string; name: string; modelId: string; enabled: boolean };
type Skill = { id: string; name: string };
type Agent = { id: string; key: string; name: string; description: string; systemPrompt: string; mcpConfig: unknown; avatarKey: string | null; primaryColor: string | null; modelId: string | null; model: { id: string; name: string; modelId: string } | null; enabled: boolean; skills: Skill[] };
type Draft = { id?: string; personaKey?: string; key: string; name: string; description: string; systemPrompt: string; mcpConfig: string; avatarKey: string; primaryColor: string; modelId: string | null; skillIds: string[]; enabled: boolean };
const EMPTY: Draft = { personaKey: "", key: "", name: "", description: "", systemPrompt: "", mcpConfig: "", avatarKey: DEFAULT_AGENT_AVATAR, primaryColor: AGENT_COLORS[0], modelId: null, skillIds: [], enabled: true };

export default function AgentsTab() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      api<{ agents: Agent[] }>("/api/admin/agents"),
      api<{ models: Model[] }>("/api/admin/models"),
      api<{ skills: Skill[] }>("/api/admin/skills"),
    ])
      .then(([a, m, s]) => { setAgents(a.agents ?? []); setModels(m.models ?? []); setSkills(s.skills ?? []); })
      .finally(() => setLoading(false));
  }, []);

  async function refresh() {
    const { agents } = await api<{ agents: Agent[] }>("/api/admin/agents");
    setAgents(agents ?? []);
  }
  function openEdit(agent: Agent) {
    setDraft({ id: agent.id, personaKey: "", key: agent.key, name: agent.name, description: agent.description, systemPrompt: agent.systemPrompt, mcpConfig: agent.mcpConfig ? JSON.stringify(agent.mcpConfig, null, 2) : "", avatarKey: agent.avatarKey ?? DEFAULT_AGENT_AVATAR, primaryColor: agent.primaryColor ?? AGENT_COLORS[0], modelId: agent.modelId, skillIds: agent.skills.map((s) => s.id), enabled: agent.enabled });
    setError("");
  }
  function openCreate() {
    const selectable = models.filter((m) => m.enabled);
    setDraft({ ...EMPTY, modelId: selectable[0]?.id ?? null });
    setError("");
  }
  function applyPersona(personaKey: string) {
    const persona = PERSONAS.find((item) => item.key === personaKey);
    setDraft((current) => persona && current ? { ...current, personaKey, key: persona.key, name: persona.name, description: persona.description, systemPrompt: persona.systemPrompt } : current ? { ...current, personaKey: "" } : current);
  }
  async function save() {
    if (!draft) return;
    let mcp: unknown = undefined;
    if (draft.mcpConfig.trim()) {
      try { mcp = JSON.parse(draft.mcpConfig); } catch { setError("MCP 配置不是合法 JSON"); return; }
    }
    setSaving(true);
    setError("");
    try {
      const agentDraft = { ...draft };
      delete agentDraft.personaKey;
      await api("/api/admin/agents", { method: draft.id ? "PUT" : "POST", body: JSON.stringify({ ...agentDraft, id: draft.id || undefined, mcpConfig: mcp }) });
      await refresh();
      setDraft(null);
    } finally {
      setSaving(false);
    }
  }
  async function remove(id: string) {
    if (!window.confirm("确认删除该 Agent？已加入房间的实例将失效。")) return;
    try { await api(`/api/admin/agents?id=${id}`, { method: "DELETE" }); refresh(); } catch { /* ignore */ }
  }
  function toggleSkill(id: string) {
    setDraft((c) => c ? { ...c, skillIds: c.skillIds.includes(id) ? c.skillIds.filter((s) => s !== id) : [...c.skillIds, id] } : c);
  }

  if (loading) return <p className="py-6 text-sm text-muted-foreground">加载 Agent 中…</p>;
  const selectableModels = models.filter((m) => m.enabled);

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Agent 管理</h2>
          <p className="mt-1 text-xs text-muted-foreground">管理可加入聊天室的 AI 助手，每个 Agent 绑定一个模型。</p>
        </div>
        <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" /> 新建 Agent</Button>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-4 font-medium">名称</th>
              <th className="py-2 pr-4 font-medium">key</th>
              <th className="py-2 pr-4 font-medium">模型</th>
              <th className="py-2 pr-4 font-medium">Skills</th>
              <th className="py-2 pr-4 font-medium">状态</th>
              <th className="py-2 pr-4 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr key={agent.id} className="border-b last:border-0 hover:bg-muted/40">
                <td className="py-2.5 pr-4 font-medium"><div className="flex items-center gap-2"><span className="agent-avatar-thumb" aria-hidden="true" style={{ backgroundImage: `url(${agent.avatarKey ?? DEFAULT_AGENT_AVATAR})` }} /><span>{agent.name}</span></div><div className="text-xs font-normal text-muted-foreground">{agent.description || "—"}</div></td>
                <td className="py-2.5 pr-4 text-muted-foreground">{agent.key}</td>
                <td className="py-2.5 pr-4">{agent.model ? agent.model.name : <Badge variant="destructive">未绑定</Badge>}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{agent.skills.length} 个</td>
                <td className="py-2.5 pr-4"><Badge variant={agent.enabled ? "success" : "destructive"}>{agent.enabled ? "启用" : "停用"}</Badge></td>
                <td className="py-2.5 pr-4 text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => openEdit(agent)}><Pencil className="h-3.5 w-3.5" /> 编辑</Button>
                    <Button variant="destructive" size="sm" onClick={() => remove(agent.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "编辑 Agent" : "新建 Agent"}</DialogTitle>
            <DialogDescription>配置助手的人设上下文、绑定模型、Skills 与 MCP。</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="grid gap-4">
              {!draft.id && <div className="grid gap-2">
                <Label>人格预设</Label>
                <Select value={draft.personaKey || "__custom__"} onValueChange={applyPersona}>
                  <SelectTrigger><SelectValue placeholder="选择一个人格预设" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__custom__">自定义人格</SelectItem>
                    {PERSONAS.map((persona) => (<SelectItem key={persona.key} value={persona.key}>{persona.name}：{persona.description}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>}
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2"><Label>名称</Label><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
                <div className="grid gap-2"><Label>key</Label><Input value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value.toLowerCase() })} placeholder="如 da-cong-ming" /></div>
              </div>
              <div className="grid gap-2"><Label>描述</Label><Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></div>
              <div className="grid gap-2"><Label>系统提示词（上下文 / 人设）</Label><Textarea rows={4} value={draft.systemPrompt} onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })} /></div>
              <div className="grid gap-2">
                <Label>Agent 头像</Label>
                <div className="agent-avatar-picker">
                  {AGENT_AVATARS.map((avatar) => (
                    <button key={avatar.key} type="button" className={`agent-avatar-option${draft.avatarKey === avatar.src ? " selected" : ""}`} onClick={() => setDraft({ ...draft, avatarKey: avatar.src })} aria-label={`选择${avatar.name}头像`} title={avatar.name}>
                      <span className="agent-avatar-option-image" aria-hidden="true" style={{ backgroundImage: `url(${avatar.src})` }} />
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-2">
                <Label>消息主色</Label>
                <div className="agent-color-row">
                  <input className="agent-color-input" type="color" value={draft.primaryColor} onChange={(event) => setDraft({ ...draft, primaryColor: event.target.value })} aria-label="选择 Agent 消息主色" />
                  <Input value={draft.primaryColor} onChange={(event) => setDraft({ ...draft, primaryColor: event.target.value })} placeholder="#3f7f86" maxLength={7} />
                  <div className="agent-color-presets">
                    {AGENT_COLORS.map((color) => <button key={color} type="button" className={`agent-color-swatch${draft.primaryColor.toLowerCase() === color ? " selected" : ""}`} style={{ background: color }} onClick={() => setDraft({ ...draft, primaryColor: color })} aria-label={`选择颜色 ${color}`} title={color} />)}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">该颜色固定用于这个 Agent 的消息背景和边框。</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>绑定模型</Label>
                  <Select value={draft.modelId ?? "__none__"} onValueChange={(v) => setDraft({ ...draft, modelId: v === "__none__" ? null : v })}>
                    <SelectTrigger><SelectValue placeholder="未绑定" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">未绑定</SelectItem>
                      {selectableModels.map((m) => (<SelectItem key={m.id} value={m.id}>{m.name}（{m.modelId}）</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2"><Label>MCP 配置（JSON）</Label><Textarea rows={3} value={draft.mcpConfig} onChange={(e) => setDraft({ ...draft, mcpConfig: e.target.value })} placeholder='{"servers": {}}' /></div>
              </div>
              <div className="grid gap-2">
                <Label>Skills</Label>
                {skills.length === 0 ? (
                  <p className="text-xs text-muted-foreground">暂无 Skills，请先在 Skills 管理中添加。</p>
                ) : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2 rounded-md border p-3">
                    {skills.map((skill) => (
                      <label key={skill.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={draft.skillIds.includes(skill.id)} onChange={() => toggleSkill(skill.id)} />
                        <span>{skill.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div><p className="text-sm font-medium">启用</p><p className="text-xs text-muted-foreground">停用后无法在房间中被提及。</p></div>
                <Switch checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
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
