import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin, AuthError } from "@/lib/auth/guards";
import { errorResponse, getRequestId, json } from "@/lib/http";

export const runtime = "nodejs";

async function publicRoles() {
  const roles = await db.role.findMany({
    orderBy: { createdAt: "asc" },
    include: { permissions: { include: { permission: { select: { key: true, description: true } } } }, _count: { select: { users: true } } },
  });
  return roles.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    permissions: r.permissions.map((rp) => ({ key: rp.permission.key, description: rp.permission.description })),
    userCount: r._count.users,
    createdAt: r.createdAt,
  }));
}

export async function GET() {
  try {
    await requireAdmin();
    return json({ roles: await publicRoles() });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status, error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
    return errorResponse("无法加载角色列表", 500, "ROLE_ERROR");
  }
}

const roleSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(50),
  description: z.string().max(500).default(""),
  permissionKeys: z.array(z.string()).default([]),
});

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = roleSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return errorResponse("角色配置不合法", 400, "VALIDATION_ERROR");
    const { permissionKeys, ...data } = parsed.data;
    const role = await db.$transaction(async (tx) => {
      const created = await tx.role.create({ data });
      if (permissionKeys.length) {
        const perms = await tx.permission.findMany({ where: { key: { in: permissionKeys } } });
        await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId: created.id, permissionId: p.id })) });
      }
      return created;
    });
    await db.auditLog.create({ data: { actorId: admin.id, action: "role.create", targetType: "Role", targetId: role.id, after: { name: role.name, permissionKeys }, requestId: getRequestId(request) } });
    return json({ roles: await publicRoles() }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status, error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
    return errorResponse("无法创建角色", 500, "ROLE_ERROR");
  }
}

export async function PUT(request: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = roleSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || !parsed.data.id) return errorResponse("角色配置不合法", 400, "VALIDATION_ERROR");
    const { id, permissionKeys, ...data } = parsed.data;
    const existing = await db.role.findUnique({ where: { id } });
    if (!existing) return errorResponse("角色不存在", 404, "NOT_FOUND");
    await db.$transaction(async (tx) => {
      await tx.role.update({ where: { id }, data: { name: data.name, description: data.description } });
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      if (permissionKeys.length) {
        const perms = await tx.permission.findMany({ where: { key: { in: permissionKeys } } });
        await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId: id, permissionId: p.id })) });
      }
    });
    await db.auditLog.create({ data: { actorId: admin.id, action: "role.update", targetType: "Role", targetId: id, after: { name: data.name, permissionKeys }, requestId: getRequestId(request) } });
    return json({ roles: await publicRoles() });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status, error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
    return errorResponse("无法更新角色", 500, "ROLE_ERROR");
  }
}

export async function DELETE(request: Request) {
  try {
    const admin = await requireAdmin();
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) return errorResponse("缺少角色 id", 400, "VALIDATION_ERROR");
    const existing = await db.role.findUnique({ where: { id } });
    if (!existing) return errorResponse("角色不存在", 404, "NOT_FOUND");
    if (existing.isSystem) return errorResponse("系统角色不可删除", 400, "VALIDATION_ERROR");
    await db.role.delete({ where: { id } });
    await db.auditLog.create({ data: { actorId: admin.id, action: "role.delete", targetType: "Role", targetId: id, requestId: getRequestId(request) } });
    return json({ roles: await publicRoles() });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status, error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
    return errorResponse("无法删除角色", 500, "ROLE_ERROR");
  }
}
