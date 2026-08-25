import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin, AuthError } from "@/lib/auth/guards";
import { errorResponse, getRequestId, json } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdmin();
    const users = await db.user.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true, displayName: true, role: true, status: true, roleId: true, createdAt: true, assignedRole: { select: { id: true, name: true } } },
      take: 200,
    });
    return json({ users });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status, error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
    return errorResponse("无法加载用户列表", 500, "USER_ERROR");
  }
}

const patchSchema = z.object({
  id: z.string(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  roleId: z.string().nullable().optional(),
});

export async function PATCH(request: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return errorResponse("用户更新不合法", 400, "VALIDATION_ERROR");
    const { id, ...data } = parsed.data;
    if (id === admin.id && data.status === "DISABLED") return errorResponse("不能停用当前登录的管理员", 400, "VALIDATION_ERROR");
    const user = await db.user.update({ where: { id }, data, select: { id: true, email: true, displayName: true, role: true, status: true, roleId: true } });
    await db.auditLog.create({ data: { actorId: admin.id, action: "user.update", targetType: "User", targetId: id, after: { status: user.status, roleId: user.roleId }, requestId: getRequestId(request) } });
    return json({ user });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status, error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
    return errorResponse("无法更新用户", 500, "USER_ERROR");
  }
}
