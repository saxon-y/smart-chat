import { z } from "zod";
import { AgentKind } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/session";
import { isUserAdmin } from "@/lib/auth/permissions";
import { activeMembership } from "@/lib/chat";
import { db } from "@/lib/db";
import { errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";

async function authorize(roomId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: errorResponse("需要先登录", 401, "UNAUTHENTICATED") };
  const [room, member] = await Promise.all([
    db.room.findUnique({ where: { id: roomId }, select: { createdById: true } }),
    activeMembership(roomId, user.id),
  ]);
  if (!room || !member) return { error: errorResponse("房间不存在或未加入", 404, "NOT_FOUND") };
  const admin = await isUserAdmin(user.id, user.role);
  if (room.createdById !== user.id && !admin) return { error: errorResponse("只有房主或管理员可以配置总管", 403, "FORBIDDEN") };
  return { user, room };
}

export async function GET(_request: Request, context: { params: Promise<{ roomId: string }> }) {
  const roomId = (await context.params).roomId;
  const user = await getCurrentUser();
  if (!user || !await activeMembership(roomId, user.id)) return errorResponse("需要先加入该房间", 403, "FORBIDDEN");
  const [config, supervisorAgent] = await Promise.all([
    db.roomSupervisor.findUnique({ where: { roomId }, include: { agent: { select: { id: true, key: true, name: true } } } }),
    db.agent.findFirst({ where: { key: "room-supervisor", kind: AgentKind.SUPERVISOR, enabled: true }, select: { id: true, key: true, name: true } }),
  ]);
  return json({ supervisor: config ?? (supervisorAgent ? { agentId: supervisorAgent.id, enabled: false, agent: supervisorAgent } : null) });
}

export async function PUT(request: Request, context: { params: Promise<{ roomId: string }> }) {
  const roomId = (await context.params).roomId;
  const auth = await authorize(roomId);
  if ("error" in auth) return auth.error;
  const parsed = z.object({ agentId: z.string().min(1).optional(), enabled: z.boolean().default(true), confidenceThreshold: z.number().min(0).max(1).default(0.75) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse("总管配置不合法", 400, "VALIDATION_ERROR");
  const agent = await db.agent.findFirst({ where: { id: parsed.data.agentId, kind: AgentKind.SUPERVISOR, enabled: true } }) ?? await db.agent.findFirst({ where: { key: "room-supervisor", kind: AgentKind.SUPERVISOR, enabled: true } });
  if (!agent) return errorResponse("总管 Agent 不存在或已停用", 404, "NOT_FOUND");
  const supervisor = await db.roomSupervisor.upsert({
    where: { roomId },
    update: { agentId: agent.id, enabled: parsed.data.enabled, confidenceThreshold: parsed.data.confidenceThreshold, configVersion: { increment: 1 } },
    create: { roomId, agentId: agent.id, enabled: parsed.data.enabled, confidenceThreshold: parsed.data.confidenceThreshold },
    include: { agent: { select: { id: true, key: true, name: true } } },
  });
  return json({ supervisor });
}
