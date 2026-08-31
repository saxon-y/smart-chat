import { z } from "zod";
import { AgentKind, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAdmin, AuthError } from "@/lib/auth/guards";
import { errorResponse, getRequestId, json } from "@/lib/http";

export const runtime = "nodejs";

const agentSchema = z.object({
  id: z.string().optional(),
  key: z.string().trim().min(1).max(100).regex(/^[a-z0-9-]+$/, "key 只能包含小写字母、数字和连字符"),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2000).default(""),
  systemPrompt: z.string().max(8000).default(""),
  kind: z.nativeEnum(AgentKind).default(AgentKind.CHAT),
  capabilities: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  avatarKey: z.string().trim().max(512).nullable().optional(),
  primaryColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "主色必须是 6 位 Hex 颜色").nullable().optional(),
  mcpConfig: z.unknown().optional(),
  modelId: z.string().optional().nullable(),
  skillIds: z.array(z.string()).optional(),
  enabled: z.boolean().default(true),
});

function publicAgent(agent: { id: string; key: string; name: string; description: string; systemPrompt: string; kind: AgentKind; capabilities: string[]; mcpConfig: unknown; avatarKey: string | null; primaryColor: string | null; modelId: string | null; enabled: boolean; createdAt: Date; updatedAt: Date; model?: { id: string; name: string; modelId: string } | null; skills?: Array<{ skill: { id: string; name: string } }> }) {
  return {
    id: agent.id,
    key: agent.key,
    name: agent.name,
    description: agent.description,
    systemPrompt: agent.systemPrompt,
    kind: agent.kind,
    capabilities: agent.capabilities,
    mcpConfig: agent.mcpConfig ?? null,
    avatarKey: agent.avatarKey,
    primaryColor: agent.primaryColor,
    modelId: agent.modelId,
    model: agent.model ? { id: agent.model.id, name: agent.model.name, modelId: agent.model.modelId } : null,
    enabled: agent.enabled,
    skills: (agent.skills ?? []).map((s) => ({ id: s.skill.id, name: s.skill.name })),
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

async function withRelations() {
  return db.agent.findMany({
    orderBy: { createdAt: "asc" },
    include: { model: { select: { id: true, name: true, modelId: true } }, skills: { include: { skill: { select: { id: true, name: true } } } } },
  });
}

export async function GET() {
  try {
    await requireAdmin();
    const agents = await withRelations();
    return json({ agents: agents.map(publicAgent) });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status, error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
    return errorResponse("无法加载 Agent 列表", 500, "AGENT_ERROR");
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = agentSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return errorResponse("Agent 配置不合法", 400, "VALIDATION_ERROR");
    const { skillIds, modelId, mcpConfig, ...data } = parsed.data;
    const agent = await db.$transaction(async (tx) => {
      const created = await tx.agent.create({
        data: { ...data, mcpConfig: mcpConfig === undefined ? undefined : (mcpConfig as Prisma.InputJsonValue), modelId: modelId || null, skills: skillIds?.length ? { create: skillIds.map((skillId) => ({ skillId })) } : undefined },
        include: { model: { select: { id: true, name: true, modelId: true } }, skills: { include: { skill: { select: { id: true, name: true } } } } },
      });
      return created;
    });
    await db.auditLog.create({ data: { actorId: admin.id, action: "agent.create", targetType: "Agent", targetId: agent.id, after: { key: agent.key, name: agent.name, modelId: agent.modelId, enabled: agent.enabled }, requestId: getRequestId(request) } });
    return json({ agent: publicAgent(agent) }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status, error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
    return errorResponse("无法创建 Agent", 500, "AGENT_ERROR");
  }
}

export async function PUT(request: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = agentSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || !parsed.data.id) return errorResponse("Agent 配置不合法", 400, "VALIDATION_ERROR");
    const { id, skillIds, modelId, mcpConfig, ...data } = parsed.data;
    const agent = await db.$transaction(async (tx) => {
      await tx.agent.update({
        where: { id },
        data: { ...data, mcpConfig: mcpConfig === undefined ? undefined : (mcpConfig as Prisma.InputJsonValue), modelId: modelId || null },
        include: { model: { select: { id: true, name: true, modelId: true } }, skills: { include: { skill: { select: { id: true, name: true } } } } },
      });
      if (skillIds) {
        await tx.agentSkill.deleteMany({ where: { agentId: id } });
        if (skillIds.length) await tx.agentSkill.createMany({ data: skillIds.map((skillId) => ({ agentId: id, skillId })) });
      }
      return tx.agent.findUnique({ where: { id }, include: { model: { select: { id: true, name: true, modelId: true } }, skills: { include: { skill: { select: { id: true, name: true } } } } } });
    });
    await db.auditLog.create({ data: { actorId: admin.id, action: "agent.update", targetType: "Agent", targetId: id, after: { key: agent?.key, name: agent?.name, modelId: agent?.modelId, enabled: agent?.enabled }, requestId: getRequestId(request) } });
    return json({ agent: publicAgent(agent!) });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status, error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
    return errorResponse("无法更新 Agent", 500, "AGENT_ERROR");
  }
}

export async function DELETE(request: Request) {
  try {
    const admin = await requireAdmin();
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) return errorResponse("缺少 Agent id", 400, "VALIDATION_ERROR");
    const requestId = getRequestId(request);
    const deleted = await db.$transaction(async (tx) => {
      const agent = await tx.agent.findUnique({ where: { id }, select: { id: true, key: true, name: true } });
      if (!agent) return null;
      await tx.roomSupervisor.deleteMany({ where: { agentId: id } });
      await tx.roomMember.updateMany({
        where: { assistantKey: agent.key, leftAt: null },
        data: { leftAt: new Date(), version: { increment: 1 } },
      });
      await tx.agent.delete({ where: { id } });
      await tx.auditLog.create({
        data: { actorId: admin.id, action: "agent.delete", targetType: "Agent", targetId: id, before: { key: agent.key, name: agent.name }, requestId },
      });
      return agent;
    });
    if (!deleted) return errorResponse("Agent 不存在", 404, "NOT_FOUND");
    return json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status, error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
    return errorResponse("无法删除 Agent", 500, "AGENT_ERROR");
  }
}
