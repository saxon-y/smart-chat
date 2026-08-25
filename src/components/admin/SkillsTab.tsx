"use client";

import { Download, FolderSearch, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/components/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Skill = { id: string; name: string; description: string; source: string; sourceRef: string | null; enabled: boolean };
type LocalSkill = { name: string; root: string; path: string; hasManifest: boolean };

const SOURCES = [
  { label: "ClawHub", url: "https://clawhub.ai/" },
  { label: "Skills.sh", url: "https://skills.sh/" },
  { label: "GitHub", url: "https://github.com/" },
];

export default function SkillsTab() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [local, setLocal] = useState<LocalSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  const [url, setUrl] = useState("");

  async function refresh() {
    const { skills } = await api<{ skills: Skill[] }>("/api/admin/skills");
    setSkills(skills ?? []);
  }
  async function refreshLocal() {
    const { skills } = await api<{ skills: LocalSkill[] }>("/api/admin/skills/local");
    setLocal(skills ?? []);
  }
  useEffect(() => {
    api<{ skills: Skill[] }>("/api/admin/skills").then((p) => setSkills(p.skills ?? [])).finally(() => setLoading(false));
  }, []);

  async function addSkill(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await api("/api/admin/skills", { method: "POST", body: JSON.stringify(body) });
      await refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }
  async function importLocal(skill: LocalSkill) {
    const ok = await addSkill({ name: skill.name, source: "LOCAL", sourceRef: skill.path, description: `从 ${skill.root} 导入` });
    if (ok) setLocal((c) => c.filter((s) => s.path !== skill.path));
  }
  async function installUrl() {
    if (!url.trim()) return;
    const ok = await addSkill({ name: url.trim().split("/").filter(Boolean).pop() ?? "skill", source: "URL", sourceRef: url.trim() });
    if (ok) { setUrl(""); setUrlOpen(false); }
  }
  async function remove(id: string) {
    if (!window.confirm("确认删除该 Skill？")) return;
    try { await api(`/api/admin/skills?id=${id}`, { method: "DELETE" }); refresh(); } catch { /* ignore */ }
  }

  if (loading) return <p className="py-6 text-sm text-muted-foreground">加载 Skills 中…</p>;

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Skills 管理</h2>
          <p className="mt-1 text-xs text-muted-foreground">支持本地导入（Codex / Claude 已安装的 Skills）和线上 URL 安装。</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { refreshLocal(); }}><FolderSearch className="h-4 w-4" /> 本地导入</Button>
          <Button size="sm" onClick={() => setUrlOpen(true)}><Download className="h-4 w-4" /> 线上安装</Button>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-4 font-medium">名称</th>
              <th className="py-2 pr-4 font-medium">来源</th>
              <th className="py-2 pr-4 font-medium">引用</th>
              <th className="py-2 pr-4 font-medium">状态</th>
              <th className="py-2 pr-4 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {skills.map((skill) => (
              <tr key={skill.id} className="border-b last:border-0 hover:bg-muted/40">
                <td className="py-2.5 pr-4 font-medium">{skill.name}<div className="text-xs font-normal text-muted-foreground">{skill.description || "—"}</div></td>
                <td className="py-2.5 pr-4"><Badge variant="secondary">{skill.source}</Badge></td>
                <td className="py-2.5 pr-4 max-w-[260px] truncate text-muted-foreground">{skill.sourceRef ?? "—"}</td>
                <td className="py-2.5 pr-4"><Badge variant={skill.enabled ? "success" : "destructive"}>{skill.enabled ? "启用" : "停用"}</Badge></td>
                <td className="py-2.5 pr-4 text-right"><Button variant="destructive" size="sm" onClick={() => remove(skill.id)}><Trash2 className="h-3.5 w-3.5" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Local import dialog */}
      <Dialog open={local.length > 0} onOpenChange={(open) => !open && setLocal([])}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>从本地导入 Skills</DialogTitle>
            <DialogDescription>扫描 ~/.codex/skills、~/.codex/agents、~/.claude/skills、~/.claude/agents。</DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground"><th className="py-2 pr-4 font-medium">名称</th><th className="py-2 pr-4 font-medium">来源</th><th className="py-2 pr-4 font-medium">清单</th><th className="py-2 pr-4 font-medium text-right">操作</th></tr></thead>
              <tbody>
                {local.map((skill) => (
                  <tr key={skill.path} className="border-b last:border-0">
                    <td className="py-2.5 pr-4 font-medium">{skill.name}</td>
                    <td className="py-2.5 pr-4"><Badge variant="secondary">{skill.root}</Badge></td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{skill.hasManifest ? "已识别" : "目录"}</td>
                    <td className="py-2.5 pr-4 text-right"><Button variant="outline" size="sm" onClick={() => importLocal(skill)} disabled={busy}><Plus className="h-3.5 w-3.5" /> 导入</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setLocal([])}>关闭</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* URL install dialog */}
      <Dialog open={urlOpen} onOpenChange={setUrlOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>线上安装 Skill</DialogTitle>
            <DialogDescription>粘贴 Skill 的 URL 地址，主要来源 ClawHub / skills.sh / GitHub。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label>URL 地址</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
            <div className="flex flex-wrap gap-2 pt-1">
              {SOURCES.map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer"><Button variant="ghost" size="sm" asChild><span>{s.label}</span></Button></a>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUrlOpen(false)}>取消</Button>
            <Button onClick={installUrl} disabled={busy}>{busy && <LoaderCircle className="h-4 w-4 animate-spin" />} 安装</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
