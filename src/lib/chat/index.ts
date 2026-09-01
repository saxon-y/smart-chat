import { AiRunMode, PrincipalType, RoomRole } from "@prisma/client";
import { db } from "@/lib/db";
import { configuredRuntimeSnapshot } from "@/lib/ai/runtime-mode";
export { messageBodySchema, validateMessageBody, extractMentionNames } from "./validation";
import { validateMessageBody, type ImageAttachment } from "./validation";
import { Prisma } from "@prisma/client";
import { publishAgentEvent, publishMessage } from "./events";

export const ASSISTANT_KEY = "da-cong-ming";
export const ASSISTANT_NAME = "大聪明";

export type MentionInput = { memberId?: string; name?: string; start?: number; end?: number };


export async function activeMembership(roomId: string, userId: string) {
  return db.roomMember.findFirst({ where: { roomId, userId, principalType: PrincipalType.USER, leftAt: null } });
}

export async function resolveMentions(roomId: string, mentions: MentionInput[] = [], body?: string) {
  if (!Array.isArray(mentions) || mentions.length > 32) throw new Error("提及信息不合法");
  const members = await db.roomMember.findMany({
    where: { roomId, leftAt: null },
    include: { user: { select: { displayName: true } } },
  });
  const byId = new Map(members.map((member) => [member.id, member]));
  const byName = new Map(members.filter((member) => member.user).map((member) => [member.user!.displayName.toLocaleLowerCase(), member]));
  const agentNames = body ? await loadAgentNames() : {};
  return mentions.map((mention) => {
    const member = mention.memberId ? byId.get(mention.memberId) : mention.name ? byName.get(mention.name.toLocaleLowerCase()) : undefined;
    if (!member) throw new Error("提及必须指向当前房间的成员");
    const displayName = member.principalType === PrincipalType.ASSISTANT
      ? agentNames[member.assistantKey ?? ""]
      : member.user?.displayName;
    const start = Number.isInteger(mention.start) && (mention.start as number) >= 0 ? mention.start as number : -1;
    const end = Number.isInteger(mention.end) && (mention.end as number) > start ? mention.end as number : -1;
    if (body !== undefined && (!displayName || start < 0 || end < 0 || body.slice(start, end).normalize("NFC") !== `@${displayName}`.normalize("NFC"))) throw new Error("提及信息与消息正文不一致");
    if (start < 0 || end < 0) throw new Error("提及位置不合法");
    return { member, start, end };
  });
}

type MemberRecord = { id: string; principalType: PrincipalType; assistantKey?: string | null; userId?: string | null; user?: { displayName: string; avatarKey?: string | null } | null; roomRole: RoomRole; joinedAt: Date };
type MessageRecord = { id: string; roomId: string; senderMemberId: string; kind: string; body: string; contentParts: Prisma.JsonValue | null; roomSequence: number; clientId: string | null; createdAt: Date; senderMember?: MemberRecord | null; mentions?: Array<{ memberId: string; start: number; end: number }> };
export async function loadAgentNames(): Promise<Record<string, string>> {
  const agents = await db.agent.findMany({ select: { key: true, name: true } });
  const map: Record<string, string> = {};
  for (const agent of agents) map[agent.key] = agent.name;
  return map;
}

export async function loadAgentStyles(): Promise<Record<string, { avatarKey: string | null; primaryColor: string | null }>> {
  const agents = await db.agent.findMany({ select: { key: true, avatarKey: true, primaryColor: true } });
  const map: Record<string, { avatarKey: string | null; primaryColor: string | null }> = {};
  for (const agent of agents) map[agent.key] = { avatarKey: agent.avatarKey, primaryColor: agent.primaryColor };
  return map;
}

export function publicMember(member: MemberRecord, agentNames?: Record<string, string>, agentStyles?: Record<string, { avatarKey: string | null; primaryColor: string | null }>) {
  const displayName = member.principalType === PrincipalType.ASSISTANT
    ? (member.assistantKey && agentNames?.[member.assistantKey]) ? agentNames[member.assistantKey] : ASSISTANT_NAME
    : member.user?.displayName;
  const style = agentStyles?.[member.assistantKey ?? ""];
  const avatarKey = member.principalType === PrincipalType.ASSISTANT ? style?.avatarKey ?? null : member.user?.avatarKey ?? null;
  const primaryColor = member.principalType === PrincipalType.ASSISTANT ? style?.primaryColor ?? null : null;
  return { id: member.id, displayName, avatarKey, primaryColor, principalType: member.principalType, assistantKey: member.assistantKey ?? null, role: member.roomRole, joinedAt: member.joinedAt, userId: member.userId ?? null, isMe: false };
}

export function markOwnMembership<T extends { userId?: string | null; isMe?: boolean }>(members: T[], currentUserId?: string | null): T[] {
  if (!currentUserId) return members;
  return members.map((member) => ({ ...member, isMe: member.userId === currentUserId }));
}

export function publicMessage(message: MessageRecord, agentNames?: Record<string, string>) {
  const sender = message.senderMember;
  const senderName = sender?.principalType === PrincipalType.ASSISTANT
    ? (sender.assistantKey && agentNames?.[sender.assistantKey]) ? agentNames[sender.assistantKey] : ASSISTANT_NAME
    : sender?.user?.displayName;
  return { id: message.id, roomId: message.roomId, senderMemberId: message.senderMemberId, senderName, kind: message.kind, body: message.body, contentParts: message.contentParts, roomSequence: message.roomSequence, clientId: message.clientId || undefined, createdAt: message.createdAt, mentions: message.mentions?.map((mention) => ({ memberId: mention.memberId, start: mention.start, end: mention.end })) ?? [] };
}

export async function createMessage(input: { roomId: string; memberId: string; body: string; attachments?: ImageAttachment[]; metadata?: { imagePrompt?: { style: string; size: string; aspect: string } }; aiAllowed?: boolean; clientId?: string; mentions?: MentionInput[]; requestId: string }) {
  const checked = validateMessageBody(input.body, Boolean(input.attachments && input.attachments.length > 0));
  if (!checked.ok) throw new Error(checked.message);
  const attachments = input.attachments ?? [];
  const parts: Array<Record<string, unknown>> = attachments.map((a) => ({ type: "image", dataUrl: a.dataUrl, name: a.name }));
  if (input.metadata?.imagePrompt) parts.push({ type: "image_prompt_config", ...input.metadata.imagePrompt });
  const contentParts: Prisma.InputJsonValue | undefined = parts.length ? parts as Prisma.InputJsonValue : undefined;
  const mentionData = await resolveMentions(input.roomId, input.mentions ?? [], checked.body);
  const result = await db.$transaction(async (tx) => {
    const member = await tx.roomMember.findFirst({ where: { id: input.memberId, roomId: input.roomId, principalType: PrincipalType.USER, leftAt: null } });
    if (!member) throw new Error("需要先加入该房间");
    if (member.mutedUntil && member.mutedUntil > new Date()) throw new Error("ROOM_MEMBER_MUTED");
    if (input.clientId) {
      const existing = await tx.message.findFirst({ where: { roomId: input.roomId, senderMemberId: member.id, clientId: input.clientId }, include: { senderMember: { include: { user: true } }, mentions: true } });
      if (existing) {
        const aiRun = await tx.aiRun.findFirst({ where: { triggerMessageId: existing.id, mode: { in: [AiRunMode.DIRECT, AiRunMode.SUPERVISOR] } }, include: { targetAgent: true } });
        return { message: existing, aiRun, duplicate: true };
      }
    }
    const room = await tx.room.update({ where: { id: input.roomId }, data: { lastSequence: { increment: 1 } } });
    const message = await tx.message.create({ data: { roomId: input.roomId, senderMemberId: member.id, body: checked.body, contentParts: contentParts ?? undefined, clientId: input.clientId, roomSequence: room.lastSequence, mentions: { create: mentionData.map(({ member, start, end }) => ({ memberId: member.id, start, end })) } }, include: { senderMember: { include: { user: true } }, mentions: true } });
    const assistantMentions = mentionData.filter(({ member }) => member.principalType === PrincipalType.ASSISTANT && member.assistantKey);
    if (assistantMentions.length > 1) throw new Error("一次只能调用一个 Agent");
    const queueDepth = await tx.aiRun.count({ where: { roomId: input.roomId, status: { in: ["PENDING", "FAILED_RETRYABLE"] } } });
    const canQueueAi = input.aiAllowed !== false && queueDepth < 50;
    let aiRun = null;
    if (canQueueAi && assistantMentions.length === 1) {
      const targetMember = assistantMentions[0].member;
      const activeTarget = await tx.roomMember.findFirst({ where: { id: targetMember.id, roomId: input.roomId, leftAt: null, version: targetMember.version } });
      if (!activeTarget) throw new Error("Agent 已不在当前房间");
      const targetAgent = await tx.agent.findUnique({ where: { key: targetMember.assistantKey! } });
      if (!targetAgent?.enabled || targetAgent.kind === "SUPERVISOR") throw new Error("Agent 不存在或不可用");
      aiRun = await tx.aiRun.create({
        data: {
          ...configuredRuntimeSnapshot(),
          triggerMessageId: message.id,
          roomId: input.roomId,
          callerMemberId: member.id,
          mode: AiRunMode.DIRECT,
          targetAgentId: targetAgent.id,
          targetMemberId: targetMember.id,
          membershipVersion: targetMember.version,
          requestId: input.requestId,
          idempotencyKey: `message:${message.id}:direct`,
        },
        include: { targetAgent: true },
      });
    } else if (canQueueAi) {
      const supervisor = await tx.roomSupervisor.findUnique({ where: { roomId: input.roomId }, include: { agent: true } });
      if (supervisor?.enabled && supervisor.agent.enabled) {
        aiRun = await tx.aiRun.create({
          data: {
            ...configuredRuntimeSnapshot(),
            triggerMessageId: message.id,
            roomId: input.roomId,
            callerMemberId: member.id,
            mode: AiRunMode.SUPERVISOR,
            configVersion: supervisor.configVersion,
            requestId: input.requestId,
            idempotencyKey: `message:${message.id}:supervisor`,
          },
          include: { targetAgent: true },
        });
      }
    }
    if (aiRun) {
      await tx.outboxEvent.create({
        data: {
          roomId: input.roomId,
          runId: aiRun.id,
          messageId: message.id,
          type: "agent_queued",
          payload: {
            runId: aiRun.id,
            agentKey: aiRun.targetAgent?.key ?? "room-supervisor",
            agentName: aiRun.targetAgent?.name ?? "房间总管",
            mode: aiRun.mode,
            status: "queued",
          },
        },
      });
    }
    return { message, aiRun, duplicate: false };
  });
  if (!result.duplicate) publishMessage(input.roomId, result.message.id);
  if (!result.duplicate && result.aiRun) {
    publishAgentEvent({
      type: "agent_queued",
      roomId: input.roomId,
      runId: result.aiRun.id,
      agentKey: result.aiRun.targetAgent?.key ?? "room-supervisor",
      agentName: result.aiRun.targetAgent?.name ?? "房间总管",
      mode: result.aiRun.mode,
      status: "queued",
    });
  }
  return result;
}

export async function joinRoom(roomId: string, userId: string) {
  const existing = await db.roomMember.findFirst({ where: { roomId, userId, principalType: PrincipalType.USER, leftAt: null } });
  return existing ?? db.roomMember.create({ data: { roomId, userId, principalType: PrincipalType.USER, roomRole: RoomRole.MEMBER } });
}
