import { db } from "@/lib/db";
import { requireAdmin, AuthError } from "@/lib/auth/guards";
import { errorResponse, getRequestId, json } from "@/lib/http";
import { decryptSecret } from "@/lib/ai/secrets";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const id = (await context.params).id;
    const model = await db.model.findUnique({ where: { id } });
    if (!model) return errorResponse("模型不存在", 404, "NOT_FOUND");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, model.timeoutMs));
    let ok = false;
    try {
      const key = model.ciphertext ? decryptSecret(model.ciphertext) : (model.secretRef ? process.env[model.secretRef] : process.env.LOCAL_AI_API_KEY);
      const response = await fetch(`${model.baseUrl.replace(/\/$/, "")}/models`, { headers: key ? { authorization: `Bearer ${key}` } : {}, signal: controller.signal });
      ok = response.ok;
    } finally {
      clearTimeout(timer);
    }
    await db.auditLog.create({ data: { actorId: admin.id, action: "model.health_check", targetType: "Model", targetId: model.id, result: ok ? "SUCCESS" : "FAILURE", after: { ok }, requestId: getRequestId(request) } });
    return json({ ok, modelId: model.id }, { status: ok ? 200 : 502 });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status, error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
    return errorResponse("模型健康检查失败", 502, "HEALTH_CHECK_FAILED");
  }
}
