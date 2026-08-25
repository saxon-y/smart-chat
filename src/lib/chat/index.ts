import { PrincipalType, RoomRole } from "@prisma/client";
import { db } from "@/lib/db";
export { messageBodySchema, validateMessageBody, extractMentionNames } from "./validation";
import { validateMessageBody, type ImageAttachment } from "./validation";
import { Prisma } from "@prisma/client";
import { publishMessage } from "./events";

export const ASSISTANT_KEY = "da-cong-ming";
export const ASSISTANT_NAME = "大聪明";

export type MentionInput = { memberId?: string; name?: string; start?: number; end?: number };


export async function activeMembership(roomId: string, userId: string) {
  return db.roomMember.findFirst({ where: { roomId, userId, principalType: PrincipalType.USER, leftAt: null } });
}

export async function resolveMentions(roomId: string, mentions: MentionInput[] = []) {
  if (!Array.isArray(mentions) || mentions.length > 32) throw new Error("提及信息不合法");
  const members = await db.roomMember.findMany({
    where: { roomId, leftAt: null },
    include: { user: { select: { displayName: true } } },
  });
  const byId = new Map(members.map((member) => [member.id, member]));
  const byName = new Map(members.filter((member) => member.user).map((member) => [member.user!.displayName.toLocaleLowerCase(), member]));
  return mentions.map((mention) => {
    const member = mention.memberId ? byId.get(mention.memberId) : mention.name ? byName.get(mention.name.toLocaleLowerCase()) : undefined;
    if (!member) throw new Error("提及必须指向当前房间的成员");
    const start = Number.isInteger(mention.start) && (mention.start as number) >= 0 ? mention.start as number : 0;
    const end = Number.isInteger(mention.end) && (mention.end as number) >= start ? mention.end as number : start;
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
  return { id: member.id, displayName, avatarKey, primaryColor, principalType: member.principalType, role: member.roomRole, joinedAt: member.joinedAt, userId: member.userId ?? null, isMe: false };
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

export async function createMessage(input: { roomId: string; memberId: string; body: string; attachments?: ImageAttachment[]; clientId?: string; mentions?: MentionInput[]; requestId: string }) {
  const checked = validateMessageBody(input.body, Boolean(input.attachments && input.attachments.length > 0));
  if (!checked.ok) throw new Error(checked.message);
  const attachments = input.attachments ?? [];
  const contentParts: Prisma.InputJsonValue | undefined = attachments.length ? attachments.map((a) => ({ type: "image", dataUrl: a.dataUrl, name: a.name })) as Prisma.InputJsonValue : undefined;
  const mentionData = await resolveMentions(input.roomId, input.mentions ?? []);
  const result = await db.$transaction(async (tx) => {
    const member = await tx.roomMember.findFirst({ where: { id: input.memberId, roomId: input.roomId, principalType: PrincipalType.USER, leftAt: null } });
    if (!member) throw new Error("需要先加入该房间");
    if (input.clientId) {
      const existing = await tx.message.findFirst({ where: { roomId: input.roomId, senderMemberId: member.id, clientId: input.clientId }, include: { senderMember: { include: { user: true } }, mentions: true } });
      if (existing) return { message: existing, aiRun: null, duplicate: true };
    }
    const room = await tx.room.update({ where: { id: input.roomId }, data: { lastSequence: { increment: 1 } } });
    const message = await tx.message.create({ data: { roomId: input.roomId, senderMemberId: member.id, body: checked.body, contentParts: contentParts ?? undefined, clientId: input.clientId, roomSequence: room.lastSequence, mentions: { create: mentionData.map(({ member, start, end }) => ({ memberId: member.id, start, end })) } }, include: { senderMember: { include: { user: true } }, mentions: true } });
    const assistantMention = mentionData.some(({ member }) => member.principalType === PrincipalType.ASSISTANT && member.assistantKey);
    let aiRun = null;
    if (assistantMention) aiRun = await tx.aiRun.create({ data: { triggerMessageId: message.id, callerMemberId: member.id, requestId: input.requestId } });
    return { message, aiRun, duplicate: false };
  });
  if (!result.duplicate) publishMessage(input.roomId, result.message.id);
  return result;
}

export async function joinRoom(roomId: string, userId: string) {
  const existing = await db.roomMember.findFirst({ where: { roomId, userId, principalType: PrincipalType.USER, leftAt: null } });
  return existing ?? db.roomMember.create({ data: { roomId, userId, principalType: PrincipalType.USER, roomRole: RoomRole.MEMBER } });
}
