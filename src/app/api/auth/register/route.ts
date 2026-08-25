import { db } from "@/lib/db";
import { errorResponse, json } from "@/lib/http";
import { createSession, hashPassword, normalizeEmail } from "@/lib/auth/session";
import { registerSchema } from "@/lib/auth/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const parsed = registerSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return errorResponse("注册信息不合法", 400, "VALIDATION_ERROR");
    const email = normalizeEmail(parsed.data.email);
    const passwordHash = await hashPassword(parsed.data.password);
    const user = await db.user.create({ data: { email, passwordHash, displayName: parsed.data.displayName } });
    await createSession(user.id);
    return json({ user: { id: user.id, email: user.email, displayName: user.displayName, avatarKey: user.avatarKey, role: user.role } }, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") return errorResponse("无法创建账号", 409, "EMAIL_UNAVAILABLE");
    return errorResponse("无法创建账号", 500, "INTERNAL_ERROR");
  }
}
