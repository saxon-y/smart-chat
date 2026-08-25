import { db } from "@/lib/db";
import { errorResponse, json } from "@/lib/http";
import { createSession, normalizeEmail, verifyPassword } from "@/lib/auth/session";
import { loginSchema } from "@/lib/auth/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse("邮箱或密码不正确", 401, "INVALID_CREDENTIALS");
  const user = await db.user.findUnique({ where: { email: normalizeEmail(parsed.data.email) } });
  const valid = user ? await verifyPassword(user.passwordHash, parsed.data.password) : false;
  if (!user || !valid || user.status !== "ACTIVE") return errorResponse("邮箱或密码不正确", 401, "INVALID_CREDENTIALS");
  await createSession(user.id);
  return json({ user: { id: user.id, email: user.email, displayName: user.displayName, avatarKey: user.avatarKey, role: user.role } });
}

