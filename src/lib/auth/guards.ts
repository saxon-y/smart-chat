import { getCurrentUser } from "@/lib/auth/session";
import { isUserAdmin } from "@/lib/auth/permissions";

export class AuthError extends Error {
  constructor(public readonly status: 401 | 403, message = "需要先登录") {
    super(message);
    this.name = "AuthError";
  }
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new AuthError(401);
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role === "ADMIN") return user;
  if (await isUserAdmin(user.id, user.role)) return user;
  throw new AuthError(403, "需要管理员权限");
}

