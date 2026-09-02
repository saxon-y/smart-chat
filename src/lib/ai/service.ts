import { AgentKind, AiRunMode, AiRunStatus, ModelProviderType, Prisma, PrincipalType } from "@prisma/client";
import { db } from "@/lib/db";
import { buildChatContext } from "@/lib/ai/context";
import { buildSupervisorPrompt, validateRoutingDecision, type RoutingCandidate } from "@/lib/ai/routing";
import { decryptSecret } from "@/lib/ai/secrets";
import { callChatProvider, generateImage, type ProviderConfig } from "@/lib/ai/providers";
import { moderateImagePrompt } from "@/lib/ai/moderation";
import { createArtifactStorage } from "@/lib/ai/artifact-storage";
import { publishAgentEvent, publishMessage } from "@/lib/chat/events";
import { claimAiRun } from "@/lib/harness/orchestration/claim";
import { cancelRun, retryRun } from "@/lib/harness/orchestration/cancellation";
import { recordRunFailure } from "@/lib/harness/orchestration/completion";
import { recoverRuns } from "@/lib/harness/orchestration/recovery";
import { projectFinalMessage } from "@/lib/harness/orchestration/result-projector";

const DEFAULT_SYSTEM_PROMPT = "你是聊天室助手。用简体中文简洁、清楚地回复，只根据当前房间上下文作答。";

type ModelConfig = {
  baseUrl: string;
  modelId: string;
  timeoutMs: number;
  ciphertext: string | null;
  secretRef: string | null;
  providerType: ModelProviderType;
};

function secretFor(config: Pick<ModelConfig, "ciphertext" | "secretRef">) {
  if (config.ciphertext) return decryptSecret(config.ciphertext);
  if (config.secretRef) return process.env[config.secretRef];
  return process.env.LOCAL_AI_API_KEY;
}

function providerConfig(config: ModelConfig): ProviderConfig {
  return { ...config, apiKey: secretFor(config) };
}

async function storeGeneratedImage(bytes: Buffer) {
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  if (!isPng && !isJpeg) throw new Error("provider_invalid_image");
  const extension = isPng ? "png" : "jpg";
  const mimeType = isPng ? "image/png" : "image/jpeg";
  const temporaryKey = `generated/${crypto.randomUUID()}.${extension}`;
  const stored = await createArtifactStorage().put(temporaryKey, bytes);
  return { ...stored, mimeType };
}

async function recentContext(roomId: string) {
  const recent = await db.message.findMany({
    where: { roomId, deletedAt: null },
    orderBy: { roomSequence: "desc" },
    take: 30,
    include: { senderMember: { select: { principalType: true, assistantKey: true, user: { select: { displayName: true } } } } },
  });
  return recent.reverse();
}

async function completeTextRun(run: Awaited<ReturnType<typeof loadRun>>, content: string, tokenUsage?: number) {
  if (!run?.targetMemberId || !run.owner) throw new Error("assistant_member_not_found");
  const projection = await projectFinalMessage({ runId: run.id, roomId: run.roomId, targetMemberId: run.targetMemberId, membershipVersion: run.membershipVersion, owner: run.owner, leaseGeneration: run.leaseGeneration, triggerMessageId: run.triggerMessageId, updatedAt: run.updatedAt, body: content, tokenUsage });
  if (projection.created) publishMessage(run.roomId, projection.message.id);
}

async function completeImageRun(run: Awaited<ReturnType<typeof loadRun>>, bytes: Buffer, revisedPrompt?: string) {
  if (!run?.targetMemberId || !run.owner) throw new Error("assistant_member_not_found");
  const stored = await storeGeneratedImage(bytes);
  let response;
  try {
    const artifact = await db.artifact.upsert({
      where: { objectKey: stored.objectKey },
      update: { runId: run.id },
      create: { runId: run.id, objectKey: stored.objectKey, mimeType: stored.mimeType, byteSize: bytes.length, sha256: stored.sha256, moderationStatus: "PROVIDER_APPROVED", expiresAt: new Date(Date.now() + Math.max(1, Number(process.env.ARTIFACT_RETENTION_DAYS ?? 30)) * 86_400_000), providerMetadata: revisedPrompt ? { revisedPrompt } : undefined },
    });
    const contentParts = [{ type: "image", artifactId: artifact.id, url: `/api/artifacts/${artifact.id}`, alt: revisedPrompt ?? "生成图片" }] as Prisma.InputJsonValue;
    const projection = await projectFinalMessage({ runId: run.id, roomId: run.roomId, targetMemberId: run.targetMemberId, membershipVersion: run.membershipVersion, owner: run.owner, leaseGeneration: run.leaseGeneration, triggerMessageId: run.triggerMessageId, updatedAt: run.updatedAt, body: revisedPrompt ? `已根据提示生成：${revisedPrompt}` : "图片已生成", contentParts, artifactId: artifact.id });
    response = projection.message;
    if (projection.created) publishMessage(run.roomId, response.id);
  } catch (error) {
    await createArtifactStorage().delete(stored.objectKey).catch(() => undefined);
    throw error;
  }
}

function loadRun(runId: string) {
  return db.aiRun.findUnique({
    where: { id: runId },
    include: { triggerMessage: true, callerMember: true, targetAgent: { include: { model: true } }, targetMember: true, room: { include: { supervisor: { include: { agent: { include: { model: true } } } } } } },
  });
}

async function runSupervisor(run: NonNullable<Awaited<ReturnType<typeof loadRun>>>) {
  const supervisor = run.room.supervisor;
  if (!supervisor?.enabled || !supervisor.agent.enabled || !supervisor.agent.model?.enabled) throw new Error("supervisor_not_configured");
  const members = await db.roomMember.findMany({ where: { roomId: run.roomId, principalType: PrincipalType.ASSISTANT, leftAt: null } });
  const keys = members.flatMap((member) => member.assistantKey ? [member.assistantKey] : []);
  const agents = await db.agent.findMany({ where: { key: { in: keys }, enabled: true, kind: { not: AgentKind.SUPERVISOR } } });
  const byKey = new Map(agents.map((agent) => [agent.key, agent]));
  const candidates: RoutingCandidate[] = members.flatMap((member) => {
    const agent = member.assistantKey ? byKey.get(member.assistantKey) : undefined;
    return agent ? [{ memberId: member.id, agentKey: agent.key, name: agent.name, capabilities: agent.capabilities }] : [];
  });
  if (!candidates.length) {
    const done = await db.$transaction(async (tx) => {
      const result = await tx.aiRun.updateMany({ where: { id: run.id, owner: run.owner, leaseGeneration: run.leaseGeneration, status: AiRunStatus.RUNNING }, data: { status: AiRunStatus.NO_ACTION, decision: "NO_ACTION", decisionReasonCode: "NO_CANDIDATES", leaseExpiresAt: null } });
      if (result.count === 1) await tx.outboxEvent.create({ data: { roomId: run.roomId, runId: run.id, type: "agent_done", payload: { ok: true, status: "no_action", reasonCode: "NO_CANDIDATES" } } });
      return result;
    });
    if (done.count !== 1) throw new Error("run_lease_lost");
    return;
  }
  const context = buildChatContext(await recentContext(run.roomId), buildSupervisorPrompt(candidates, supervisor.confidenceThreshold));
  const result = await callChatProvider(providerConfig(supervisor.agent.model), context);
  const decision = validateRoutingDecision(result.content, candidates, supervisor.confidenceThreshold);
  if (decision.action === "NO_ACTION") {
    const done = await db.$transaction(async (tx) => {
      const changed = await tx.aiRun.updateMany({ where: { id: run.id, owner: run.owner, leaseGeneration: run.leaseGeneration, status: AiRunStatus.RUNNING }, data: { status: AiRunStatus.NO_ACTION, decision: "NO_ACTION", decisionConfidence: decision.confidence, decisionReasonCode: decision.reasonCode, tokenUsage: result.tokenUsage, leaseExpiresAt: null } });
      if (changed.count === 1) await tx.outboxEvent.create({ data: { roomId: run.roomId, runId: run.id, type: "agent_done", payload: { ok: true, status: "no_action", reasonCode: decision.reasonCode } } });
      return changed;
    });
    if (done.count !== 1) throw new Error("run_lease_lost");
    publishAgentEvent({ type: "agent_done", roomId: run.roomId, runId: run.id, agentKey: supervisor.agent.key, agentName: supervisor.agent.name, mode: run.mode, status: "no_action", ok: true });
    return;
  }
  const targetMember = members.find((member) => member.id === decision.targetMemberId)!;
  const targetAgent = byKey.get(targetMember.assistantKey!)!;
  const child = await db.$transaction(async (tx) => {
    const targetStillActive = await tx.roomMember.findFirst({ where: { id: targetMember.id, roomId: run.roomId, leftAt: null, version: targetMember.version } });
    const agentStillActive = await tx.agent.findFirst({ where: { id: targetAgent.id, enabled: true, kind: { not: AgentKind.SUPERVISOR }, capabilities: { has: decision.capability }, model: { is: { enabled: true } } } });
    if (!targetStillActive || !agentStillActive) throw new Error("agent_not_available");
    const done = await tx.aiRun.updateMany({ where: { id: run.id, owner: run.owner, leaseGeneration: run.leaseGeneration, status: AiRunStatus.RUNNING }, data: { status: AiRunStatus.SUCCEEDED, decision: "DELEGATE", decisionConfidence: decision.confidence, decisionReasonCode: decision.reasonCode, tokenUsage: result.tokenUsage, leaseExpiresAt: null } });
    if (done.count !== 1) throw new Error("run_lease_lost");
    return tx.aiRun.create({ data: { triggerMessageId: run.triggerMessageId, roomId: run.roomId, callerMemberId: run.callerMemberId, mode: AiRunMode.DELEGATED, parentRunId: run.id, targetAgentId: targetAgent.id, targetMemberId: targetMember.id, membershipVersion: targetMember.version, configVersion: supervisor.configVersion, runtimeId: run.runtimeId, runtimeKind: run.runtimeKind, runtimeVersion: run.runtimeVersion, requestId: run.requestId, idempotencyKey: `${run.id}:${targetMember.id}` } });
  });
  publishAgentEvent({ type: "agent_routed", roomId: run.roomId, runId: child.id, agentKey: targetAgent.key, agentName: targetAgent.name, mode: child.mode, status: "routed" });
  await processAiRun(child.id);
}

async function runAgent(run: NonNullable<Awaited<ReturnType<typeof loadRun>>>) {
  const agent = run.targetAgent;
  const member = run.targetMember;
  if (!agent?.enabled || !member || member.leftAt || member.version !== run.membershipVersion) throw new Error("agent_not_available");
  if (!agent.model?.enabled) throw new Error("model_not_configured");
  publishAgentEvent({ type: "agent_progress", roomId: run.roomId, runId: run.id, agentKey: agent.key, agentName: agent.name, mode: run.mode, status: agent.kind === AgentKind.IMAGE ? "generating" : "running" });
  if (agent.kind === AgentKind.IMAGE) {
    const parts = Array.isArray(run.triggerMessage.contentParts) ? run.triggerMessage.contentParts : [];
    const imageConfig = parts.find((part): part is { type: string; style?: string; size?: string; aspect?: string } => Boolean(part && typeof part === "object" && !Array.isArray(part) && (part as { type?: string }).type === "image_prompt_config"));
    const style = imageConfig?.style && imageConfig.style !== "auto" ? `\n风格：${imageConfig.style}` : "";
    const prompt = `${agent.systemPrompt}\n\n用户要求：${run.triggerMessage.body}${style}`.trim();
    const moderation = moderateImagePrompt(prompt);
    if (!moderation.allowed) throw new Error(moderation.reasonCode.toLocaleLowerCase());
    const requestedAspect = imageConfig?.aspect ?? "1:1";
    const geminiAspect = agent.model.providerType === "GEMINI_IMAGES"
      ? ({ "1:1": "1:1", "3:2": "4:3", "2:3": "3:4" } as Record<string, string>)[requestedAspect] ?? "1:1"
      : requestedAspect;
    const image = await generateImage(providerConfig(agent.model), prompt, imageConfig?.size ?? "1024x1024", geminiAspect);
    await completeImageRun(run, image.bytes, image.revisedPrompt);
  } else {
    const result = await callChatProvider(providerConfig(agent.model), buildChatContext(await recentContext(run.roomId), agent.systemPrompt || DEFAULT_SYSTEM_PROMPT));
    await completeTextRun(run, result.content, result.tokenUsage);
  }
}

export async function processAiRun(runId: string) {
  const owner = `${process.pid}:${crypto.randomUUID()}`;
  if (!await claimAiRun(runId, owner)) return;
  let run = await loadRun(runId);
  if (!run) throw new Error("ai_run_not_found");
  const started = await db.aiRun.updateMany({ where: { id: run.id, owner, status: AiRunStatus.CLAIMED }, data: { status: AiRunStatus.RUNNING } });
  if (started.count !== 1) return;
  run = await loadRun(runId);
  if (!run) throw new Error("ai_run_not_found");
  try {
    if (run.callerMember.leftAt || run.callerMember.roomId !== run.roomId) throw new Error("caller_membership_revoked");
    if (run.mode === AiRunMode.SUPERVISOR) await runSupervisor(run);
    else await runAgent(run);
    const completed = await loadRun(runId);
    if (completed?.status === AiRunStatus.SUCCEEDED && completed.targetAgent) {
      publishAgentEvent({ type: "agent_done", roomId: completed.roomId, runId: completed.id, agentKey: completed.targetAgent.key, agentName: completed.targetAgent.name, mode: completed.mode, status: "succeeded", ok: true });
    }
  } catch (error) {
    const raw = error instanceof Error ? error.message : "provider_request_failed";
    const errorCode = /^[a-z0-9_]+$/.test(raw) ? raw : "provider_request_failed";
    const nextStatus = await recordRunFailure({ runId: run.id, roomId: run.roomId, owner: run.owner, leaseGeneration: run.leaseGeneration, attempt: run.attempt, errorCode });
    const agent = run.targetAgent ?? run.room.supervisor?.agent;
    publishAgentEvent({ type: "agent_done", roomId: run.roomId, runId: run.id, agentKey: agent?.key ?? "unknown", agentName: agent?.name ?? "AI 助手", mode: run.mode, status: nextStatus.toLowerCase(), ok: false, error: errorCode });
    throw new Error(errorCode);
  }
}

export async function recoverPendingAiRuns(limit = 20) {
  return recoverRuns(processAiRun, limit);
}

export async function listRoomAiRuns(roomId: string, limit = 50, cursor?: string) {
  const take = Math.max(1, Math.min(limit, 100));
  return db.aiRun.findMany({
    where: { roomId, ...(cursor ? { id: { lt: cursor } } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    include: {
      targetAgent: { select: { key: true, name: true } },
      targetMember: { select: { id: true, assistantKey: true } },
      triggerMessage: { select: { id: true, body: true, roomSequence: true } },
    },
  });
}

export async function cancelAiRun(roomId: string, runId: string) {
  return cancelRun(roomId, runId);
}

export async function retryAiRun(roomId: string, runId: string) {
  return retryRun(roomId, runId);
}
