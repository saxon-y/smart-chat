import { db } from "@/lib/db";

export async function userPermissionKeys(userId: string): Promise<Set<string>> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { assignedRole: { select: { permissions: { include: { permission: { select: { key: true } } } } } } },
  });
  if (!user?.assignedRole) return new Set<string>();
  return new Set(user.assignedRole.permissions.map((rp) => rp.permission.key));
}

export async function hasPermission(userId: string, key: string): Promise<boolean> {
  return (await userPermissionKeys(userId)).has(key);
}

/** Admin access = UserRole.ADMIN or a role granting the admin.access permission. */
export async function isUserAdmin(userId: string, roleEnum: string): Promise<boolean> {
  if (roleEnum === "ADMIN") return true;
  return hasPermission(userId, "admin.access");
}
