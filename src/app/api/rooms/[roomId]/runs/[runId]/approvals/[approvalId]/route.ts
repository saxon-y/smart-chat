import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { isUserAdmin } from "@/lib/auth/permissions";
import { decideAgentApproval } from "@/lib/harness/approvals";
import { errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";

const bodySchema = z.strictObject({
  decision: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().trim().max(500).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ roomId: string; runId: string; approvalId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return errorResponse("需要先登录", 401, "UNAUTHENTICATED");
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return errorResponse("审批参数无效", 400, "INVALID_APPROVAL");
  const { roomId, runId, approvalId } = await context.params;
  const result = await decideAgentApproval({
    roomId, runId, approvalId, userId: user.id,
    isAdmin: user.role === "ADMIN" || await isUserAdmin(user.id, user.role),
    decision: body.data.decision, reason: body.data.reason,
  });
  if (result.kind === "NOT_FOUND") return errorResponse("审批不存在", 404, "NOT_FOUND");
  if (result.kind === "FORBIDDEN") return errorResponse("没有审批权限", 403, "FORBIDDEN");
  if (result.kind === "ARGUMENTS_CHANGED") return errorResponse("工具参数已变化，需要重新审批", 409, "APPROVAL_ARGUMENTS_CHANGED");
  if (result.kind === "CONFLICT") return errorResponse("审批状态已变化", 409, "APPROVAL_CONFLICT");
  return json({ approval: result.approval });
}
