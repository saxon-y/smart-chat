import { db } from "@/lib/db";
import { requireAdmin, AuthError } from "@/lib/auth/guards";
import { errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const status = new URL(request.url).searchParams.get("status") ?? "PENDING";
    const requests = await db.roomJoinRequest.findMany({
      where: { status: status as never },
      orderBy: { createdAt: "desc" },
      take: 500,
      include: { user: { select: { displayName: true, email: true } }, room: { select: { id: true, name: true, slug: true } } },
    });
    return json({ requests });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status, "FORBIDDEN");
    return errorResponse("无法加载入群申请", 500, "JOIN_REQUEST_ERROR");
  }
}
