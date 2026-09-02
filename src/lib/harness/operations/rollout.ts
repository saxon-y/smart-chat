import { createHash } from "node:crypto";
import type { AgentRuntimeMode } from "@/lib/ai/runtime-mode";

export interface RuntimeRolloutConfig {
  defaultMode: AgentRuntimeMode;
  percentage: number;
  roomIds: ReadonlySet<string>;
  agentIds: ReadonlySet<string>;
  runtimeKinds: ReadonlySet<string>;
}

export interface RuntimeRolloutSubject {
  roomId: string;
  agentId?: string | null;
  runtimeKind?: string | null;
}

const MODES = new Set<AgentRuntimeMode>(["legacy", "embedded", "self_hosted"]);
const list = (value?: string) => new Set((value ?? "").split(",").map((item) => item.trim()).filter(Boolean));

export function runtimeRolloutConfig(env: Readonly<Record<string, string | undefined>> = process.env): RuntimeRolloutConfig {
  const mode = (env.AGENT_RUNTIME_CANARY_MODE ?? env.AGENT_RUNTIME_MODE ?? "legacy").trim().toLowerCase() as AgentRuntimeMode;
  if (!MODES.has(mode)) throw new Error(`invalid_runtime_rollout_mode:${mode}`);
  const rawPercentage = Number(env.AGENT_RUNTIME_CANARY_PERCENT ?? 0);
  if (!Number.isFinite(rawPercentage) || rawPercentage < 0 || rawPercentage > 100) throw new Error("invalid_runtime_rollout_percentage");
  return {
    defaultMode: mode,
    percentage: rawPercentage,
    roomIds: list(env.AGENT_RUNTIME_CANARY_ROOM_IDS),
    agentIds: list(env.AGENT_RUNTIME_CANARY_AGENT_IDS),
    runtimeKinds: list(env.AGENT_RUNTIME_CANARY_KINDS),
  };
}

function bucket(subject: RuntimeRolloutSubject) {
  const digest = createHash("sha256").update(`${subject.roomId}:${subject.agentId ?? "-"}`).digest();
  return digest.readUInt32BE(0) % 100;
}

export function selectRolloutMode(subject: RuntimeRolloutSubject, config = runtimeRolloutConfig()): AgentRuntimeMode {
  const targeted = config.roomIds.has(subject.roomId)
    || Boolean(subject.agentId && config.agentIds.has(subject.agentId))
    || Boolean(subject.runtimeKind && config.runtimeKinds.has(subject.runtimeKind));
  return targeted || bucket(subject) < config.percentage ? config.defaultMode : "legacy";
}

export function canMoveRunBetweenRuntimes(run: { toolCallCount: number; status: string }) {
  return run.toolCallCount === 0 && ["PENDING", "FAILED_RETRYABLE"].includes(run.status);
}
