import { sha256Digest } from "../protocol/canonical";
import type { ToolIdempotency } from "./types";

export type ToolCallLedgerState = "ABSENT" | "PENDING" | "SUCCEEDED" | "FAILED_KNOWN" | "OUTCOME_UNKNOWN";
export type ToolRecoveryAction = "EXECUTE" | "RETURN_RECORDED_RESULT" | "RETRY_WITH_SAME_KEY" | "WAIT_FOR_IN_FLIGHT" | "BLOCK_FOR_REVIEW";

export function argumentsDigest(argumentsValue: unknown) {
  return sha256Digest(argumentsValue);
}

export function createToolIdempotencyKey(runId: string, toolCallId: string, digest: string) {
  if (!runId || !toolCallId || !/^[a-f0-9]{64}$/.test(digest)) throw new Error("tool_idempotency_key_invalid");
  return `${runId}:${toolCallId}:${digest}`;
}

export function decideToolRecovery(idempotency: ToolIdempotency, state: ToolCallLedgerState): ToolRecoveryAction {
  if (state === "SUCCEEDED") return "RETURN_RECORDED_RESULT";
  if (state === "PENDING") return "WAIT_FOR_IN_FLIGHT";
  if (state === "OUTCOME_UNKNOWN" && idempotency === "NON_IDEMPOTENT") return "BLOCK_FOR_REVIEW";
  if (state === "ABSENT") return "EXECUTE";
  return "RETRY_WITH_SAME_KEY";
}

/** Persistence implementations must claim a key atomically before invoking a side effect. */
export interface ToolCallLedger<TResult = unknown> {
  claim(key: string): Promise<{ claimed: true } | { claimed: false; state: ToolCallLedgerState; result?: TResult }>;
  complete(key: string, result: TResult): Promise<void>;
  fail(key: string, outcomeKnown: boolean): Promise<void>;
}
