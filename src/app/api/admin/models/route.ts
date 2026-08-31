import { z } from "zod";
import { ModelProviderType } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAdmin, AuthError } from "@/lib/auth/guards";
import { errorResponse, getRequestId, json } from "@/lib/http";
import { encryptSecret } from "@/lib/ai/secrets";
import { providerUrlAllowedByPolicy } from "@/lib/ai/provider-security";

export const runtime = "nodejs";

const modelSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(100),
  modelId: z.string().trim().min(1).max(200),
  baseUrl: z.string().url().max(1000).refine(providerUrlAllowedByPolicy, "接口地址不符合 Provider 安全策略"),
  providerType: z.nativeEnum(ModelProviderType).default(ModelProviderType.OPENAI_COMPATIBLE),
  apiKey: z.string().max(1000).optional(),
  secretRef: z.string().trim().min(1).max(200).optional(),
  timeoutMs: z.number().int().min(1000).max(120000).default(30000),
  enabled: z.boolean().default(true),
});

function publicModel(model: { id: string; name: string; modelId: string; baseUrl: string; providerType: ModelProviderType; secretRef: string | null; ciphertext: string | null; timeoutMs: number; enabled: boolean; createdAt: Date; updatedAt: Date }) {
  return {
    id: model.id,
    name: model.name,
    modelId: model.modelId,
    baseUrl: model.baseUrl,
    providerType: model.providerType,
    hasApiKey: Boolean(model.ciphertext || (model.secretRef && process.env[model.secretRef])),
    timeoutMs: model.timeoutMs,
    enabled: model.enabled,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
}

export async function GET() {
  try {
    await requireAdmin();
    const models = await db.model.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { agents: true } } } });
    return json({ models: models.map((m) => ({ ...publicModel(m), agentCount: m._count.agents })) });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status, error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
    return errorResponse("无法加载模型列表", 500, "MODEL_ERROR");
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = modelSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return errorResponse("模型配置不合法", 400, "VALIDATION_ERROR");
    const { apiKey, ...data } = parsed.data;
    if (data.providerType === ModelProviderType.GEMINI_IMAGES && !apiKey && !data.secretRef) return errorResponse("Gemini 图片模型必须配置 API Key", 400, "VALIDATION_ERROR");
    const model = await db.model.create({ data: { ...data, ciphertext: apiKey ? encryptSecret(apiKey) : null } });
    await db.auditLog.create({ data: { actorId: admin.id, action: "model.create", targetType: "Model", targetId: model.id, after: { name: model.name, modelId: model.modelId, baseUrl: model.baseUrl, enabled: model.enabled }, requestId: getRequestId(request) } });
    return json({ model: publicModel(model) }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status, error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
    return errorResponse("无法创建模型", 500, "MODEL_ERROR");
  }
}

export async function PUT(request: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = modelSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || !parsed.data.id) return errorResponse("模型配置不合法", 400, "VALIDATION_ERROR");
    const { id, apiKey, ...data } = parsed.data;
    if (data.providerType === ModelProviderType.GEMINI_IMAGES && !apiKey && !data.secretRef) {
      const existing = await db.model.findUnique({ where: { id }, select: { ciphertext: true, secretRef: true } });
      if (!existing?.ciphertext && !existing?.secretRef) return errorResponse("Gemini 图片模型必须配置 API Key", 400, "VALIDATION_ERROR");
    }
    const model = await db.model.update({ where: { id }, data: { ...data, ...(apiKey ? { ciphertext: encryptSecret(apiKey) } : {}) } });
    await db.auditLog.create({ data: { actorId: admin.id, action: "model.update", targetType: "Model", targetId: model.id, after: { name: model.name, modelId: model.modelId, baseUrl: model.baseUrl, enabled: model.enabled }, requestId: getRequestId(request) } });
    return json({ model: publicModel(model) });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status, error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
    return errorResponse("无法更新模型", 500, "MODEL_ERROR");
  }
}

export async function DELETE(request: Request) {
  try {
    const admin = await requireAdmin();
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) return errorResponse("缺少模型 id", 400, "VALIDATION_ERROR");
    await db.model.delete({ where: { id } });
    await db.auditLog.create({ data: { actorId: admin.id, action: "model.delete", targetType: "Model", targetId: id, requestId: getRequestId(request) } });
    return json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status, error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
    return errorResponse("无法删除模型", 500, "MODEL_ERROR");
  }
}
