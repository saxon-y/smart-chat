"use client";

import { LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/components/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pagination } from "./Pagination";

type Permission = { key: string; description: string };
type Role = { id: string; name: string; description: string; isSystem: boolean; permissions: Permission[]; userCount: number };

type Draft = { id: string; name: string; description: string; permissionKeys: string[] };
const EMPTY: Draft = { id: "", name: "", description: "", permissionKeys: [] };

export default function RolesTab() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  async function refresh() {
    const { roles } = await api<{ roles: Role[] }>("/api/admin/roles");
    setRoles(roles ?? []);
  }
  useEffect(() => {
    Promise.all([api<{ roles: Role[] }>("/api/admin/roles"), api<{ permissions: Permission[] }>("/api/admin/permissions")])
      .then(([r, p]) => {
        setRoles(r.roles ?? []);
        setPermissions(p.permissions ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  function openEdit(role: Role) {
    setDraft({ id: role.id, name: role.name, description: role.description, permissionKeys: role.permissions.map((p) => p.key) });
  }
  function openCreate() {
    setDraft({ ...EMPTY });
  }
  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      await api("/api/admin/roles", {
        method: draft.id ? "PUT" : "POST",
        body: JSON.stringify({ id: draft.id || undefined, name: draft.name, description: draft.description, permissionKeys: draft.permissionKeys }),
      });
      await refresh();
      setDraft(null);
    } finally {
      setSaving(false);
    }
  }
  async function remove(id: string) {
    if (!window.confirm("确认删除该角色？")) return;
    try {
      await api(`/api/admin/roles?id=${id}`, { method: "DELETE" });
      await refresh();
    } catch {
      /* ignore */
    }
  }
  function togglePerm(key: string) {
    setDraft((current) => current ? {
      ...current,
      permissionKeys: current.permissionKeys.includes(key) ? current.permissionKeys.filter((k) => k !== key) : [...current.permissionKeys, key],
    } : current);
  }

  if (loading) return <p className="py-6 text-sm text-muted-foreground">加载角色中…</p>;

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">角色管理</h2>
          <p className="mt-1 text-xs text-muted-foreground">创建角色并为角色配置不同的使用权限。</p>
        </div>
        <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" /> 新建角色</Button>
      </div>
      <div className="admin-list-scroll mt-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-4 font-medium">角色</th>
              <th className="py-2 pr-4 font-medium">说明</th>
              <th className="py-2 pr-4 font-medium">权限</th>
              <th className="py-2 pr-4 font-medium">用户数</th>
              <th className="py-2 pr-4 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {roles.slice((page - 1) * pageSize, page * pageSize).map((role) => (
              <tr key={role.id} className="border-b last:border-0 hover:bg-muted/40">
                <td className="py-2.5 pr-4 font-medium">
                  {role.name}
                  {role.isSystem && <Badge variant="secondary" className="ml-2">系统</Badge>}
                </td>
                <td className="py-2.5 pr-4 text-muted-foreground">{role.description || "—"}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{role.permissions.length} 项</td>
                <td className="py-2.5 pr-4">{role.userCount}</td>
                <td className="py-2.5 pr-4 text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="icon" className="admin-icon-button" data-tooltip="编辑角色" onClick={() => openEdit(role)} aria-label={`编辑 ${role.name}`} title="编辑角色"><Pencil /></Button>
                    {!role.isSystem && (
                      <Button variant="destructive" size="icon" className="admin-icon-button" data-tooltip="删除角色" onClick={() => remove(role.id)} aria-label={`删除 ${role.name}`} title="删除角色"><Trash2 /></Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={pageSize} total={roles.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />

      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "编辑角色" : "新建角色"}</DialogTitle>
            <DialogDescription>为角色命名并勾选它拥有的使用权限。</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>名称</Label>
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>说明</Label>
                <Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>权限</Label>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2 rounded-md border p-3">
                  {permissions.map((perm) => (
                    <label key={perm.key} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={draft.permissionKeys.includes(perm.key)} onChange={() => togglePerm(perm.key)} />
                      <span>{perm.description}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>取消</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <LoaderCircle className="h-4 w-4 animate-spin" />} 保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
