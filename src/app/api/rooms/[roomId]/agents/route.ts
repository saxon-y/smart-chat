import { z } from "zod";
import { Prisma, PrincipalType } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { isUserAdmin } from "@/lib/auth/permissions";
import { activeMembership, loadAgentNames, loadAgentStyles, publicMember } from "@/lib/chat";
import { errorResponse, json } from "@/lib/http";
import { roomPermission } from "@/lib/chat/rooms";

export const runtime = "nodejs";

async function roomAndUser(roomId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: errorResponse("需要先登录", 401, "UNAUTHENTICATED") };
  const room = await db.room.findUnique({ where: { id: roomId }, select: { id: true, createdById: true, status: true } });
  if (!room) return { error: errorResponse("房间不存在", 404, "NOT_FOUND") };
  const membership = await activeMembership(roomId, user.id);
  if (!membership) return { error: errorResponse("需要先加入该房间", 403, "FORBIDDEN") };
  return { user, room, membership };
}

export async function GET(_request: Request, context: { params: Promise<{ roomId: string }> }) {
  const roomId = (await context.params).roomId;
  const result = await roomAndUser(roomId);
  if ("error" in result) return result.error;
  if (!(await roomPermission(result.user.id, roomId, "canAddAgent"))) return errorResponse("无权添加 Agent", 403, "FORBIDDEN");
  const [agents, members, agentNames] = await Promise.all([
    db.agent.findMany({ where: { enabled: true, kind: { not: "SUPERVISOR" } }, orderBy: { name: "asc" }, select: { key: true, name: true, description: true, kind: true, capabilities: true } }),
    db.roomMember.findMany({ where: { roomId, principalType: PrincipalType.ASSISTANT, leftAt: null }, select: { id: true, assistantKey: true, joinedAt: true } }),
    loadAgentNames(),
  ]);
  const inRoom = new Set(members.map((m) => m.assistantKey));
  return json({
    available: agents.map((a) => ({ key: a.key, name: a.name, description: a.description, kind: a.kind, capabilities: a.capabilities, inRoom: inRoom.has(a.key) })),
    inRoom: members.map((m) => ({ id: m.id, key: m.assistantKey, name: agentNames[m.assistantKey ?? ""] ?? m.assistantKey ?? "agent" })),
  });
}

export async function POST(request: Request, context: { params: Promise<{ roomId: string }> }) {
  const roomId = (await context.params).roomId;
  const result = await roomAndUser(roomId);
  if ("error" in result) return result.error;
  const isOwner = result.membership.roomRole === "OWNER" || result.room.createdById === result.user.id;
  const isAdmin = await isUserAdmin(result.user.id, result.user.role);
  if (!isOwner && !isAdmin) return errorResponse("只有房主或管理员可以添加 Agent", 403, "FORBIDDEN");
  const parsed = z.object({ agentKey: z.string().min(1) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse("请求不合法", 400, "VALIDATION_ERROR");
  const agent = await db.agent.findUnique({ where: { key: parsed.data.agentKey } });
  if (!agent || !agent.enabled || agent.kind === "SUPERVISOR") return errorResponse("Agent 不存在、已停用或不可加入房间", 404, "NOT_FOUND");
  const existing = await db.roomMember.findFirst({ where: { roomId, assistantKey: agent.key, leftAt: null } });
  if (existing) return errorResponse("该 Agent 已在房间中", 409, "DUPLICATE");
  let member;
  try {
    member = await db.roomMember.create({ data: { roomId, principalType: PrincipalType.ASSISTANT, assistantKey: agent.key } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return errorResponse("该 Agent 已在房间中", 409, "DUPLICATE");
    throw error;
  }
  const [agentNames, agentStyles] = await Promise.all([loadAgentNames(), loadAgentStyles()]);
  return json({ member: publicMember(member, agentNames, agentStyles) }, { status: 201 });
}

export async function DELETE(request: Request, context: { params: Promise<{ roomId: string }> }) {
  const roomId = (await context.params).roomId;
  const result = await roomAndUser(roomId);
  if ("error" in result) return result.error;
  const isOwner = result.membership.roomRole === "OWNER" || result.room.createdById === result.user.id;
  const isAdmin = await isUserAdmin(result.user.id, result.user.role);
  if (!isOwner && !isAdmin) return errorResponse("只有房主或管理员可以移除 Agent", 403, "FORBIDDEN");
  const url = new URL(request.url);
  const agentKey = url.searchParams.get("agentKey");
  if (!agentKey) return errorResponse("缺少 agentKey", 400, "VALIDATION_ERROR");
  const member = await db.roomMember.findFirst({ where: { roomId, assistantKey: agentKey, leftAt: null } });
  if (!member) return errorResponse("该 Agent 不在房间中", 404, "NOT_FOUND");
  await db.roomMember.update({ where: { id: member.id }, data: { leftAt: new Date(), version: { increment: 1 } } });
  return json({ ok: true });
}
