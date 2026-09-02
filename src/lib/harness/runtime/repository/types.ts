import type { Prisma } from "@prisma/client";
import type { CompletedTurn } from "../loop";

export interface LeaseGuard {
  runId: string;
  owner: string;
  leaseGeneration: number;
  now?: Date;
}

export interface CheckpointInput {
  runtimeSessionId?: string;
  taskDigest: string;
  contextGeneration: number;
  skillBundleHash: string;
  mcpBundleDigest: string;
  loadedSkillIds: Prisma.InputJsonValue;
  loadedToolSchemaIds: Prisma.InputJsonValue;
  inboundSequence?: number;
  cumulativeUsage: Prisma.InputJsonValue;
  summary?: Prisma.InputJsonValue;
}

export interface PendingToolCallInput {
  id: string;
  toolId: string;
  toolVersion: string;
  arguments: Prisma.InputJsonValue;
  argumentsDigest: string;
  risk: string;
  concurrency: string;
  idempotencyKey?: string;
}

export interface CommitTurnInput {
  turn: CompletedTurn;
  prefixDigest: string;
  loadedSkillIds: Prisma.InputJsonValue;
  loadedToolSchemaIds: Prisma.InputJsonValue;
  thinking?: Prisma.InputJsonValue;
  thinkingContinuity?: string;
  pendingToolCalls?: readonly PendingToolCallInput[];
  checkpoint?: CheckpointInput;
}

export interface ResumeDigests {
  taskDigest: string;
  skillBundleHash: string;
  mcpBundleDigest: string;
}

export type ToolResumeAction =
  | { action: "RESUME"; toolCallId: string }
  | { action: "RETRY_IDEMPOTENT"; toolCallId: string; idempotencyKey: string }
  | { action: "BLOCK"; toolCallId: string; reason: "UNKNOWN_SIDE_EFFECT" };

