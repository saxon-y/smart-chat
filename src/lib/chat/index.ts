import { AiRunMode, PrincipalType, RoomRole } from "@prisma/client";
import { db } from "@/lib/db";
import { configuredRuntimeSnapshot } from "@/lib/ai/runtime-mode";
export { messageBodySchema, validateMessageBody, extractMentionNames } from "./validation";
import { validateMessageBody, type ImageAttachment, type ArtifactAttachment } from "./validation";
import { Prisma } from "@prisma/client";
import { publishAgentEvent, publishMessage } from "./events";
import { createNotification } from "@/lib/notifications";
import { roomPermission } from "./rooms";

export const ASSISTANT_KEY = "da-cong-ming";
export const ASSISTANT_NAME = "大聪明";
export const ALLOWED_REACTION_EMOJIS = ["👍", "❤️", "😂", "🎉", "😮", "😢", "😡"] as const;
export type ReactionEmoji = typeof ALLOWED_REACTION_EMOJIS[number];

export type MentionInput = { memberId?: string; name?: string; start?: number; end?: number };


export async function activeMembership(roomId: string, userId: string) {
  const member = await db.roomMember.findFirst({ where: { roomId, userId, principalType: PrincipalType.USER, leftAt: null } });
  if (!member || !await roomPermission(userId, roomId, "canView")) return null;
  return member;
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
type MessageRecord = { id: string; roomId: string; senderMemberId: string; kind: string; body: string; contentParts: Prisma.JsonValue | null; roomSequence: number; clientId: string | null; createdAt: Date; editedAt?: Date | null; deletedAt?: Date | null; senderMember?: MemberRecord | null; mentions?: Array<{ memberId: string; start: number; end: number }>; reactions?: Array<{ emoji: string; memberId: string }>; replyTo?: ReplyMessageRecord | null };
type ReplyMessageRecord = Pick<MessageRecord, "id" | "roomId" | "senderMemberId" | "kind" | "body" | "createdAt"> & { senderMember?: MemberRecord | null };
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
  const reply = message.replyTo;
  const replySender = reply?.senderMember;
  const replySenderName = replySender?.principalType === PrincipalType.ASSISTANT
    ? (replySender.assistantKey && agentNames?.[replySender.assistantKey]) ? agentNames[replySender.assistantKey] : ASSISTANT_NAME
    : replySender?.user?.displayName;
  const reactions = Object.fromEntries((message.reactions ?? []).reduce((map, reaction) => { const item = map.get(reaction.emoji) ?? { count: 0, memberIds: [] as string[] }; item.count += 1; item.memberIds.push(reaction.memberId); map.set(reaction.emoji, item); return map; }, new Map<string, { count: number; memberIds: string[] }>()));
  return { id: message.id, roomId: message.roomId, senderMemberId: message.senderMemberId, senderName, kind: message.kind, body: message.body, contentParts: message.contentParts, roomSequence: message.roomSequence, clientId: message.clientId || undefined, createdAt: message.createdAt, editedAt: message.editedAt ?? null, mentions: message.mentions?.map((mention) => ({ memberId: mention.memberId, start: mention.start, end: mention.end })) ?? [], reactions, replyTo: reply ? { id: reply.id, roomId: reply.roomId, senderMemberId: reply.senderMemberId, senderName: replySenderName, kind: reply.kind, body: reply.body.length > 280 ? `${reply.body.slice(0, 280)}...` : reply.body, createdAt: reply.createdAt } : null };
}

export async function toggleMessageReaction(input: { roomId: string; messageId: string; memberId: string; emoji: string }) {
  if (!(ALLOWED_REACTION_EMOJIS as readonly string[]).includes(input.emoji)) throw new Error("不支持的表情");
  const result = await db.$transaction(async (tx) => {
    const message = await tx.message.findFirst({ where: { id: input.messageId, roomId: input.roomId, deletedAt: null }, select: { id: true } });
    if (!message) throw new Error("消息不存在");
    const existing = await tx.messageReaction.findUnique({ where: { messageId_memberId_emoji: { messageId: message.id, memberId: input.memberId, emoji: input.emoji } } });
    if (existing) { await tx.messageReaction.delete({ where: { id: existing.id } }); return false; }
    await tx.messageReaction.create({ data: { messageId: message.id, memberId: input.memberId, emoji: input.emoji } }); return true;
  });
  publishMessage(input.roomId, input.messageId);
  return { active: result };
}

export async function createMessage(input: { roomId: string; memberId: string; body: string; attachments?: Array<ImageAttachment | ArtifactAttachment>; metadata?: { imagePrompt?: { style: string; size: string; aspect: string } }; aiAllowed?: boolean; clientId?: string; mentions?: MentionInput[]; replyToId?: string | null; requestId: string }) {
  const checked = validateMessageBody(input.body, Boolean(input.attachments && input.attachments.length > 0));
  if (!checked.ok) throw new Error(checked.message);
  const attachments = input.attachments ?? [];
  const parts: Array<Record<string, unknown>> = attachments.map((a) => a.type === "artifact" ? ({ type: "artifact", artifactId: a.artifactId, name: a.name, url: `/api/artifacts/${a.artifactId}` }) : ({ type: "image", dataUrl: a.dataUrl, name: a.name }));
  if (input.metadata?.imagePrompt) parts.push({ type: "image_prompt_config", ...input.metadata.imagePrompt });
  const contentParts: Prisma.InputJsonValue | undefined = parts.length ? parts as Prisma.InputJsonValue : undefined;
  const mentionData = await resolveMentions(input.roomId, input.mentions ?? [], checked.body);
  const result = await db.$transaction(async (tx) => {
    const member = await tx.roomMember.findFirst({ where: { id: input.memberId, roomId: input.roomId, principalType: PrincipalType.USER, leftAt: null } });
    if (!member) throw new Error("需要先加入该房间");
    const artifactIds = attachments.filter((a): a is ArtifactAttachment => a.type === "artifact").map((a) => a.artifactId);
    if (artifactIds.length && await tx.artifact.count({ where: { id: { in: artifactIds }, roomId: input.roomId, deletedAt: null } }) !== artifactIds.length) throw new Error("附件不存在或不属于当前房间");
    if (member.mutedUntil && member.mutedUntil > new Date()) throw new Error("ROOM_MEMBER_MUTED");
    let replyToId: string | null = null;
    if (input.replyToId) {
      const reply = await tx.message.findFirst({ where: { id: input.replyToId, roomId: input.roomId, deletedAt: null }, select: { id: true } });
      if (!reply) throw new Error("引用消息不存在或不属于当前房间");
      replyToId = reply.id;
    }
    if (input.clientId) {
      const existing = await tx.message.findFirst({ where: { roomId: input.roomId, senderMemberId: member.id, clientId: input.clientId }, include: { senderMember: { include: { user: true } }, mentions: true, replyTo: { include: { senderMember: { include: { user: true } } } } } });
      if (existing) {
        const aiRun = await tx.aiRun.findFirst({ where: { triggerMessageId: existing.id, mode: { in: [AiRunMode.DIRECT, AiRunMode.SUPERVISOR] } }, include: { targetAgent: true } });
        return { message: existing, aiRun, duplicate: true };
      }
    }
    const room = await tx.room.update({ where: { id: input.roomId }, data: { lastSequence: { increment: 1 } } });
    const message = await tx.message.create({ data: { roomId: input.roomId, senderMemberId: member.id, body: checked.body, contentParts: contentParts ?? undefined, clientId: input.clientId, roomSequence: room.lastSequence, replyToId, mentions: { create: mentionData.map(({ member, start, end }) => ({ memberId: member.id, start, end })) } }, include: { senderMember: { include: { user: true } }, mentions: true, replyTo: { include: { senderMember: { include: { user: true } } } } } });
    const assistantMentions = mentionData.filter(({ member }) => member.principalType === PrincipalType.ASSISTANT && member.assistantKey);
    const uniqueAssistantMentions = [...new Map(assistantMentions.map((mention) => [mention.member.assistantKey, mention])).values()];
    if (uniqueAssistantMentions.length > 3) throw new Error("一次最多调用三个 Agent");
    const queueDepth = await tx.aiRun.count({ where: { roomId: input.roomId, status: { in: ["PENDING", "FAILED_RETRYABLE"] } } });
    const canQueueAi = input.aiAllowed !== false && queueDepth < 50;
    let aiRun = null;
    const aiRuns: Prisma.AiRunGetPayload<{ include: { targetAgent: true } }>[] = [];
    if (canQueueAi && uniqueAssistantMentions.length > 0) {
      for (const mention of uniqueAssistantMentions) {
      const targetMember = mention.member;
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
          idempotencyKey: `message:${message.id}:direct:${targetMember.id}`,
        },
        include: { targetAgent: true },
      });
      aiRuns.push(aiRun);
      }
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
    for (const queuedRun of aiRuns.length ? aiRuns : aiRun ? [aiRun] : []) {
      await tx.outboxEvent.create({
        data: {
          roomId: input.roomId,
          runId: queuedRun.id,
          messageId: message.id,
          type: "agent_queued",
          payload: {
            runId: queuedRun.id,
            agentKey: queuedRun.targetAgent?.key ?? "room-supervisor",
            agentName: queuedRun.targetAgent?.name ?? "房间总管",
            mode: queuedRun.mode,
            status: "queued",
          },
        },
      });
    }
    return { message, aiRun: aiRuns[0] ?? aiRun, aiRuns, duplicate: false };
  });
  if (!result.duplicate) publishMessage(input.roomId, result.message.id);
  if (!result.duplicate && result.message.mentions?.length) {
    const mentioned = await db.roomMember.findMany({ where: { id: { in: result.message.mentions.map((mention) => mention.memberId) }, roomId: input.roomId, principalType: PrincipalType.USER, leftAt: null }, select: { id: true, userId: true } });
    await Promise.all(mentioned.filter((member) => member.userId && member.id !== input.memberId).map((member) => createNotification({ userId: member.userId!, roomId: input.roomId, type: "MENTION", title: "有人提到了你", summary: checked.body, sourceId: result.message.id, sourceType: "message", dedupeKey: `mention:${result.message.id}:${member.userId}` })));
  }
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
  for (const run of result.aiRuns?.slice(1) ?? []) publishAgentEvent({ type: "agent_queued", roomId: input.roomId, runId: run.id, agentKey: run.targetAgent?.key ?? "room-supervisor", agentName: run.targetAgent?.name ?? "房间总管", mode: run.mode, status: "queued" });
  return result;
}

export async function editMessage(input: { roomId: string; memberId: string; messageId: string; body: string }) {
  const checked = validateMessageBody(input.body);
  if (!checked.ok) throw new Error(checked.message);
  return db.$transaction(async (tx) => {
    const message = await tx.message.findFirst({ where: { id: input.messageId, roomId: input.roomId, senderMemberId: input.memberId, deletedAt: null } });
    if (!message) throw new Error("消息不存在或无权编辑");
    if (message.kind !== "TEXT") throw new Error("该消息类型不支持编辑");
    return tx.message.update({ where: { id: message.id }, data: { body: checked.body, editedAt: new Date() }, include: { senderMember: { include: { user: true } }, mentions: true, replyTo: { include: { senderMember: { include: { user: true } } } } } });
  });
}

export async function deleteMessage(input: { roomId: string; memberId: string; messageId: string }) {
  return db.$transaction(async (tx) => {
    const message = await tx.message.findFirst({ where: { id: input.messageId, roomId: input.roomId, senderMemberId: input.memberId, deletedAt: null } });
    if (!message) throw new Error("消息不存在或无权删除");
    return tx.message.update({ where: { id: message.id }, data: { deletedAt: new Date() }, include: { senderMember: { include: { user: true } }, mentions: true, replyTo: { include: { senderMember: { include: { user: true } } } } } });
  });
}

export async function joinRoom(roomId: string, userId: string) {
  const existing = await db.roomMember.findFirst({ where: { roomId, userId, principalType: PrincipalType.USER, leftAt: null } });
  return existing ?? db.roomMember.create({ data: { roomId, userId, principalType: PrincipalType.USER, roomRole: RoomRole.MEMBER } });
}
