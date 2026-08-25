import { AiRunStatus, MessageKind, PrincipalType } from "@prisma/client";
import { db } from "@/lib/db";
import { buildChatContext } from "@/lib/ai/context";
import { decryptSecret } from "@/lib/ai/secrets";
import { publishAiDone, publishAiThinking, publishMessage } from "@/lib/chat/events";

type TriggerInput = { roomId: string; triggerMessageId: string; callerMemberId?: string; requestId?: string };

function secretFor(config: { ciphertext: string | null; secretRef: string | null }) {
  if (config.ciphertext) return decryptSecret(config.ciphertext);
  if (config.secretRef) return process.env[config.secretRef];
  return process.env.LOCAL_AI_API_KEY;
}

const DEFAULT_SYSTEM_PROMPT = "你是聊天室助手。用简体中文简洁、清楚地回复，只根据当前房间上下文作答。";

function resolveChatUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "");
  if (base.endsWith("/chat/completions")) return base;
  if (/\/v\d+$/.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

async function callProvider(baseUrl: string, model: string, apiKey: string | undefined, messages: ReturnType<typeof buildChatContext>, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    const response = await fetch(resolveChatUrl(baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model, messages }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`provider_http_${response.status}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { total_tokens?: number } };
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("provider_empty_response");
    return { content, tokenUsage: payload.usage?.total_tokens };
  } finally {
    clearTimeout(timer);
  }
}

export async function triggerAiForMessage(input: TriggerInput) {
  const requestId = input.requestId ?? crypto.randomUUID();
  const trigger = await db.message.findUnique({
    where: { id: input.triggerMessageId },
    include: { senderMember: true, mentions: { include: { member: true } } },
  });
  if (!trigger || trigger.roomId !== input.roomId) throw new Error("trigger_message_not_found");
  const callerMemberId = input.callerMemberId ?? trigger.senderMemberId;
  const run = await db.aiRun.upsert({
    where: { triggerMessageId: trigger.id },
    update: { requestId, status: AiRunStatus.RUNNING, attempt: { increment: 1 } },
    create: { triggerMessageId: trigger.id, callerMemberId, requestId, status: AiRunStatus.RUNNING, attempt: 1 },
  });
  const started = Date.now();
  let mentionedAssistant: { assistantKey: string | null; id: string } | undefined;
  try {
    // Resolve the specific agent that was mentioned in this room.
    mentionedAssistant = trigger.mentions
      .map((mention) => mention.member)
      .find((member) => member && member.principalType === PrincipalType.ASSISTANT && member.assistantKey && member.leftAt === null);
    if (!mentionedAssistant) throw new Error("assistant_member_not_found");
    const assistant = mentionedAssistant;
    const agent = await db.agent.findUnique({
      where: { key: assistant.assistantKey! },
      include: { model: true, skills: { include: { skill: true } } },
    });
    if (!agent || !agent.enabled) throw new Error("agent_not_available");
    if (!agent.model || !agent.model.enabled) throw new Error("model_not_configured");

    publishAiThinking(input.roomId, agent.key, agent.name, trigger.id);

    const apiKey = secretFor(agent.model);
    const recent = await db.message.findMany({
      where: { roomId: input.roomId, deletedAt: null },
      orderBy: { createdAt: "desc" }, take: 30,
      include: { senderMember: { select: { principalType: true, assistantKey: true, user: { select: { displayName: true } } } } },
    });
    const result = await callProvider(
      agent.model.baseUrl,
      agent.model.modelId,
      apiKey,
      buildChatContext(recent.reverse(), agent.systemPrompt || DEFAULT_SYSTEM_PROMPT),
      agent.model.timeoutMs,
    );
    const responseMessage = await db.$transaction(async (tx) => {
      const room = await tx.room.update({ where: { id: input.roomId }, data: { lastSequence: { increment: 1 } }, select: { lastSequence: true } });
      return tx.message.create({ data: { roomId: input.roomId, senderMemberId: assistant.id, kind: MessageKind.AI, body: result.content, roomSequence: room.lastSequence, replyToId: trigger.id } });
    });
    await db.aiRun.update({ where: { id: run.id }, data: { status: AiRunStatus.SUCCEEDED, responseMessageId: responseMessage.id, tokenUsage: result.tokenUsage, latencyMs: Date.now() - started } });
    publishMessage(input.roomId, responseMessage.id);
    publishAiDone(input.roomId, agent.key, trigger.id, true);
    return responseMessage;
  } catch (error) {
    const errorCode = error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : "provider_request_failed";
    await db.aiRun.update({ where: { id: run.id }, data: { status: AiRunStatus.FAILED_RETRYABLE, errorCode, latencyMs: Date.now() - started } }).catch(() => undefined);
    publishAiDone(input.roomId, mentionedAssistant?.assistantKey ?? "unknown", trigger.id, false, errorCode);
    throw new Error(errorCode);
  }
}
