"use client";

import { LoaderCircle, Pencil, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/components/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Pagination } from "./Pagination";

type Role = { id: string; name: string };
type User = {
  id: string;
  email: string;
  displayName: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "DISABLED";
  roleId: string | null;
  assignedRole?: { id: string; name: string } | null;
  createdAt: string;
};

export default function UsersTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<User | null>(null);
  const [roleId, setRoleId] = useState<string>("__none__");
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    Promise.all([
      api<{ users: User[] }>("/api/admin/users"),
      api<{ roles: Role[] }>("/api/admin/roles"),
    ])
      .then(([u, r]) => {
        setUsers(u.users ?? []);
        setRoles(r.roles ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  function openEdit(user: User) {
    setEditing(user);
    setRoleId(user.roleId ?? "__none__");
    setActive(user.status === "ACTIVE");
  }
  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      const { user } = await api<{ user: User }>("/api/admin/users", {
        method: "PATCH",
        body: JSON.stringify({ id: editing.id, status: active ? "ACTIVE" : "DISABLED", roleId: roleId === "__none__" ? null : roleId }),
      });
      setUsers((current) => current.map((u) => (u.id === editing.id ? { ...u, ...user, assignedRole: roles.find((r) => r.id === user.roleId) ?? null } : u)));
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="py-6 text-sm text-muted-foreground">加载用户中…</p>;

  return (
    <div className="rounded-xl border bg-card p-5">
      <h2 className="text-base font-semibold">用户管理</h2>
      <p className="mt-1 text-xs text-muted-foreground">查看用户基础信息，分配角色或停用 / 启用账号。</p>
      <div className="admin-list-scroll mt-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-4 font-medium">用户</th>
              <th className="py-2 pr-4 font-medium">邮箱</th>
              <th className="py-2 pr-4 font-medium">系统角色</th>
              <th className="py-2 pr-4 font-medium">使用角色</th>
              <th className="py-2 pr-4 font-medium">状态</th>
              <th className="py-2 pr-4 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.slice((page - 1) * pageSize, page * pageSize).map((user) => (
              <tr key={user.id} className="border-b last:border-0 hover:bg-muted/40">
                <td className="py-2.5 pr-4 font-medium">{user.displayName}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{user.email}</td>
                <td className="py-2.5 pr-4">
                  <Badge variant={user.role === "ADMIN" ? "default" : "outline"}>
                    {user.role === "ADMIN" && <ShieldCheck className="mr-1 h-3 w-3" />}
                    {user.role}
                  </Badge>
                </td>
                <td className="py-2.5 pr-4 text-muted-foreground">{user.assignedRole?.name ?? "未分配"}</td>
                <td className="py-2.5 pr-4">
                  <Badge variant={user.status === "ACTIVE" ? "success" : "destructive"}>
                    {user.status === "ACTIVE" ? "启用" : "停用"}
                  </Badge>
                </td>
                <td className="py-2.5 pr-4 text-right">
                  <Button variant="outline" size="icon" className="admin-icon-button" data-tooltip="编辑用户" onClick={() => openEdit(user)} aria-label={`编辑 ${user.displayName}`} title="编辑用户">
                    <Pencil />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={pageSize} total={users.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>编辑用户 · {editing?.displayName}</DialogTitle>
            <DialogDescription>{editing?.email}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>使用角色</Label>
              <Select value={roleId} onValueChange={setRoleId}>
                <SelectTrigger><SelectValue placeholder="未分配" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">未分配</SelectItem>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">启用账号</p>
                <p className="text-xs text-muted-foreground">停用后该用户将无法登录</p>
              </div>
              <Switch checked={active} onCheckedChange={setActive} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>取消</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <LoaderCircle className="h-4 w-4 animate-spin" />} 保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
