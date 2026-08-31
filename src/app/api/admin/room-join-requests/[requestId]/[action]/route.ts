import { db } from "@/lib/db";
import { requireAdmin, AuthError } from "@/lib/auth/guards";
import { errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ requestId: string; action: string }> }) {
  try {
    const admin = await requireAdmin();
    const { requestId, action } = await context.params;
    if (action !== "approve" && action !== "reject") return errorResponse("无效操作", 400, "BAD_REQUEST");
    const joinRequest = await db.roomJoinRequest.findUnique({ where: { id: requestId } });
    if (!joinRequest) return errorResponse("申请不存在", 404, "NOT_FOUND");
    if (joinRequest.status !== "PENDING") return errorResponse("申请已处理", 409, "CONFLICT");
    const body = await request.json().catch(() => ({}));
    const result = await db.$transaction(async (tx) => {
      if (action === "approve") {
        const existing = await tx.roomMember.findFirst({ where: { roomId: joinRequest.roomId, userId: joinRequest.userId, principalType: "USER", leftAt: null } });
        const member = existing ?? await tx.roomMember.create({ data: { roomId: joinRequest.roomId, userId: joinRequest.userId, principalType: "USER" } });
        await tx.roomJoinRequest.update({ where: { id: requestId }, data: { status: "APPROVED", reviewedById: admin.id, reviewedAt: new Date() } });
        return { member };
      }
      await tx.roomJoinRequest.update({ where: { id: requestId }, data: { status: "REJECTED", reviewedById: admin.id, reviewedAt: new Date(), reviewReason: typeof body?.reason === "string" ? body.reason.slice(0, 500) : undefined } });
      return { rejected: true };
    });
    return json(result);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status, "FORBIDDEN");
    return errorResponse("审核入群申请失败", 500, "JOIN_REQUEST_ERROR");
  }
}
