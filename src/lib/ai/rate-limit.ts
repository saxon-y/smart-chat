import { AgentKind, AiRunMode, AiRunStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export type AiRunQuotaKind = "text" | "image";

export type RunQuotaOptions = {
  userId: string;
  roomId: string;
  kind?: AiRunQuotaKind;
  now?: Date;
  userLimit?: number;
  roomLimit?: number;
  imageWindowMs?: number;
};

export type RunQuotaResult = {
  allowed: boolean;
  userCount: number;
  roomCount: number;
  limit: number;
  roomLimit: number;
  remaining: number;
  roomRemaining: number;
  windowStart: Date;
  resetAt: Date;
  kind: AiRunQuotaKind;
};

export class AiRunRateLimitError extends Error {
  readonly status = 429;
  readonly code = "AI_RUN_RATE_LIMITED";
  constructor(public readonly quota: RunQuotaResult, message = "AI 请求过于频繁，请稍后再试") {
    super(message);
    this.name = "AiRunRateLimitError";
  }
}

const numberEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

/** Counts recent runs without introducing a quota table or requiring a migration. */
export async function getAiRunQuota(options: RunQuotaOptions): Promise<RunQuotaResult> {
  const kind = options.kind ?? "text";
  const now = options.now ?? new Date();
  const image = kind === "image";
  const windowMs = options.imageWindowMs ?? (image ? numberEnv("AI_IMAGE_QUOTA_WINDOW_MS", 86_400_000) : numberEnv("AI_RUN_QUOTA_WINDOW_MS", 60_000));
  const windowStart = new Date(now.getTime() - Math.max(1, windowMs));
  const userLimit = options.userLimit ?? (image ? numberEnv("AI_USER_IMAGE_RUN_LIMIT", 20) : numberEnv("AI_USER_RUN_LIMIT", 30));
  const roomLimit = options.roomLimit ?? (image ? numberEnv("AI_ROOM_IMAGE_RUN_LIMIT", 50) : numberEnv("AI_ROOM_RUN_LIMIT", 120));
  const imageWhere = image ? { targetAgent: { is: { kind: AgentKind.IMAGE } } } : { targetAgent: { isNot: { kind: AgentKind.IMAGE } } };
  const common = { createdAt: { gte: windowStart, lte: now }, ...imageWhere } as Prisma.AiRunWhereInput;
  const [userCount, roomCount] = await Promise.all([
    db.aiRun.count({ where: { ...common, callerMember: { userId: options.userId } } }),
    db.aiRun.count({ where: { ...common, roomId: options.roomId } }),
  ]);
  const remaining = Math.max(0, userLimit - userCount);
  const roomRemaining = Math.max(0, roomLimit - roomCount);
  return { allowed: userCount < userLimit && roomCount < roomLimit, userCount, roomCount, limit: userLimit, roomLimit, remaining, roomRemaining, windowStart, resetAt: new Date(windowStart.getTime() + Math.max(1, windowMs)), kind };
}

export async function assertAiRunQuota(options: RunQuotaOptions): Promise<RunQuotaResult> {
  const quota = await getAiRunQuota(options);
  if (!quota.allowed) throw new AiRunRateLimitError(quota);
  return quota;
}

// Short aliases for call sites that prefer a generic guard name.
export const checkAiRunQuota = getAiRunQuota;
export const enforceAiRunQuota = assertAiRunQuota;

export const ACTIVE_AI_RUN_STATUSES = [AiRunStatus.PENDING, AiRunStatus.CLAIMED, AiRunStatus.RUNNING, AiRunStatus.FAILED_RETRYABLE] as const;
export const AI_RUN_MODES = [AiRunMode.DIRECT, AiRunMode.SUPERVISOR, AiRunMode.DELEGATED] as const;
