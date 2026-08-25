import { db } from "@/lib/db";
import { requireAdmin, AuthError } from "@/lib/auth/guards";
import { errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdmin();
    const permissions = await db.permission.findMany({ orderBy: { key: "asc" } });
    return json({ permissions });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status, error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
    return errorResponse("无法加载权限列表", 500, "PERMISSION_ERROR");
  }
}
