import type { RunResult, TaskEnvelope, Usage } from "../../protocol";
import type { ModelProvider, ModelRequest, ModelResponse } from "../providers";
import type { DeltaBatch } from "./delta-aggregator";
import type { RuntimeObserver } from "../../observability";

export const AGENT_LOOP_STATES = [
  "LOAD", "BUILD_INPUT", "MODEL", "AUTHORIZE", "TOOLS", "APPEND",
  "CHECK_LIMITS", "CHECKPOINT", "FINALIZE",
] as const;

export type AgentLoopState = (typeof AGENT_LOOP_STATES)[number];

export interface LoopSnapshot {
  task: TaskEnvelope;
  turnCount: number;
  toolCallCount: number;
  usage: Usage;
}

export interface CompletedTurn {
  number: number;
  inputDigest: string;
  request: ModelRequest;
  response: ModelResponse;
  usage: Usage;
}

export interface ToolRequest {
  callId: string;
  name: string;
  arguments: unknown;
}

export type ToolAuthorization =
  | { decision: "ALLOW" }
  | { decision: "DENY"; reason: string }
  | { decision: "REQUIRE_APPROVAL"; approvalId: string; reason: string };

export interface ToolExecutionResult {
  callId: string;
  toolId: string;
  ok: boolean;
  output: unknown;
}

export interface AgentLoopPorts {
  provider: ModelProvider;
  load(task: TaskEnvelope, signal: AbortSignal): Promise<LoopSnapshot>;
  buildInput(snapshot: LoopSnapshot, signal: AbortSignal): Promise<{ request: ModelRequest; inputDigest: string }>;
  commitTurn(turn: CompletedTurn, signal: AbortSignal): Promise<void>;
  authorize(tool: ToolRequest, snapshot: LoopSnapshot, signal: AbortSignal): Promise<ToolAuthorization>;
  executeTool(tool: ToolRequest, snapshot: LoopSnapshot, signal: AbortSignal): Promise<ToolExecutionResult>;
  appendToolResult(result: ToolExecutionResult, snapshot: LoopSnapshot, signal: AbortSignal): Promise<void>;
  persistDelta?(batch: DeltaBatch, signal: AbortSignal): Promise<void>;
  checkpoint(snapshot: LoopSnapshot, signal: AbortSignal): Promise<void>;
  finalize(result: RunResult, snapshot: LoopSnapshot): Promise<void>;
  isCancellationRequested?(runId: string): Promise<boolean>;
  now?: () => number;
}

export interface AgentLoopOutcome {
  result: RunResult;
  snapshot: LoopSnapshot;
  states: AgentLoopState[];
}

export interface AgentLoopOptions {
  deltaMaxBytes?: number;
  deltaMaxDelayMs?: number;
  /** Independent guard against implementation or provider loops. */
  maxStateTransitions?: number;
  observer?: RuntimeObserver;
}
