import { getCurrentUser } from "@/lib/auth/session";
import { isUserAdmin } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { errorResponse, json } from "@/lib/http";
import { profileSchema } from "@/lib/auth/validation";

export const runtime = "nodejs";

function publicUser(user: { id: string; email: string; displayName: string; avatarKey: string | null; role: string; createdAt: Date }) {
  return { id: user.id, email: user.email, displayName: user.displayName, avatarKey: user.avatarKey, role: user.role, createdAt: user.createdAt };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return errorResponse("需要先登录", 401, "UNAUTHENTICATED");
  const isAdmin = await isUserAdmin(user.id, user.role);
  return json({ user: { ...publicUser(user), isAdmin } });
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return errorResponse("需要先登录", 401, "UNAUTHENTICATED");
  const parsed = profileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse("资料信息不合法", 400, "VALIDATION_ERROR");
  const updated = await db.user.update({ where: { id: user.id }, data: parsed.data });
  return json({ user: publicUser(updated) });
}

