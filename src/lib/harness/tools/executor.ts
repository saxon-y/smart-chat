import type { ExecutionPolicy } from "../protocol/policy";
import { ToolPolicyEngine, type PolicyAuditEntry } from "../policy/engine";
import { argumentsDigest, createToolIdempotencyKey, decideToolRecovery, type ToolCallLedger } from "./idempotency";
import { ToolRegistry, ToolRegistryError } from "./registry";
import type { RegisteredTool, ToolExecutionContext } from "./types";

export interface OversizedToolResultStore {
  put(input: { runId: string; toolCallId: string; toolId: string; bytes: Uint8Array; mimeType: "application/json" }): Promise<{ artifactId: string }>;
}

export interface ToolExecutorRequest {
  runId: string;
  roomId: string;
  toolCallId: string;
  toolId: string;
  toolVersion: string;
  expectedSchemaDigest: string;
  arguments: unknown;
  policy: ExecutionPolicy;
  skillAllowedTools: ReadonlySet<string>;
  agentCapabilities: ReadonlySet<string>;
  remainingToolCalls: number;
  remainingWallTimeMs: number;
  approvedArgumentsDigest?: string;
  targetHost?: string;
  checkMemberPermission(): boolean | Promise<boolean>;
  checkArgumentBoundary(argumentsValue: unknown): boolean | Promise<boolean>;
}

export type ToolSuccessResult =
  | { status: "SUCCEEDED"; result: unknown; replayed: boolean; audit: readonly PolicyAuditEntry[] }
  | { status: "SUCCEEDED"; result: { artifactId: string; mediaType: "application/json"; truncated: true }; replayed: boolean; audit: readonly PolicyAuditEntry[] };

export type ToolExecutorResult = ToolSuccessResult
  | { status: "DENIED" | "REQUIRE_APPROVAL" | "BLOCKED"; reason: string; audit: readonly PolicyAuditEntry[] };

function bytes(value: unknown): Uint8Array {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new ToolRegistryError("tool_result_not_serializable");
  }
  if (serialized === undefined) throw new ToolRegistryError("tool_result_not_serializable");
  return new TextEncoder().encode(serialized);
}

function roomBoundary(roomId: string, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return true;
  const supplied = (value as Record<string, unknown>).roomId;
  return supplied === undefined || supplied === roomId;
}

export class ToolExecutor {
  private readonly inFlight = new Map<string, Promise<ToolExecutorResult>>();

  constructor(
    private readonly registry: ToolRegistry,
    private readonly ledger: ToolCallLedger<ToolSuccessResult>,
    private readonly artifacts: OversizedToolResultStore,
    private readonly policyEngine = new ToolPolicyEngine(),
  ) {}

  async execute(request: ToolExecutorRequest): Promise<ToolExecutorResult> {
    const tool = this.registry.resolve(request.toolId, request.toolVersion, request.expectedSchemaDigest);
    const parsed = tool.inputSchema.safeParse(request.arguments);
    if (!parsed.success) throw new ToolRegistryError("tool_arguments_invalid");

    const policy = await this.policyEngine.evaluate({
      tool,
      policy: request.policy,
      arguments: parsed.data,
      expectedSchemaDigest: request.expectedSchemaDigest,
      skillAllowedTools: request.skillAllowedTools,
      agentCapabilities: request.agentCapabilities,
      checkMemberPermission: request.checkMemberPermission,
      checkArgumentBoundary: async (value) => roomBoundary(request.roomId, value) && await request.checkArgumentBoundary(value),
      targetHost: request.targetHost,
      remainingToolCalls: request.remainingToolCalls,
      remainingWallTimeMs: request.remainingWallTimeMs,
      approvedArgumentsDigest: request.approvedArgumentsDigest,
    });
    if (policy.decision !== "ALLOW") {
      return { status: policy.decision === "DENY" ? "DENIED" : "REQUIRE_APPROVAL", reason: policy.reason, audit: policy.audit };
    }

    const digest = argumentsDigest(parsed.data);
    const key = createToolIdempotencyKey(request.runId, request.toolCallId, digest);
    const running = this.inFlight.get(key);
    if (running) return running;

    const execution = this.executeClaimed(tool, parsed.data, request, key, policy.audit);
    this.inFlight.set(key, execution);
    try {
      return await execution;
    } finally {
      if (this.inFlight.get(key) === execution) this.inFlight.delete(key);
    }
  }

  private async executeClaimed(
    tool: RegisteredTool,
    input: unknown,
    request: ToolExecutorRequest,
    key: string,
    audit: readonly PolicyAuditEntry[],
  ): Promise<ToolExecutorResult> {
    const claim = await this.ledger.claim(key);
    if (!claim.claimed) {
      const action = decideToolRecovery(tool.idempotency, claim.state);
      if (action === "RETURN_RECORDED_RESULT" && claim.result) return { ...claim.result, replayed: true };
      if (action === "WAIT_FOR_IN_FLIGHT") return { status: "BLOCKED", reason: "tool_call_in_flight", audit };
      if (action === "BLOCK_FOR_REVIEW") return { status: "BLOCKED", reason: "non_idempotent_outcome_unknown", audit };
      if (action !== "RETRY_WITH_SAME_KEY") return { status: "BLOCKED", reason: "tool_ledger_claim_conflict", audit };
    }

    try {
      const result = await this.invoke(tool, input, {
        runId: request.runId,
        toolCallId: request.toolCallId,
        idempotencyKey: key,
      });
      const encoded = bytes(result);
      const output: ToolSuccessResult = encoded.byteLength <= tool.maxResultBytes
        ? { status: "SUCCEEDED", result, replayed: false, audit }
        : {
            status: "SUCCEEDED",
            result: { ...(await this.artifacts.put({ runId: request.runId, toolCallId: request.toolCallId, toolId: tool.id, bytes: encoded, mimeType: "application/json" })), mediaType: "application/json", truncated: true },
            replayed: false,
            audit,
          };
      await this.ledger.complete(key, output);
      return output;
    } catch (error) {
      const outcomeKnown = error instanceof ToolRegistryError && ["tool_timeout", "tool_result_not_serializable"].includes(error.code);
      await this.ledger.fail(key, outcomeKnown);
      throw error;
    }
  }

  private async invoke(tool: RegisteredTool, input: unknown, context: Omit<ToolExecutionContext, "signal">) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ToolRegistryError("tool_timeout"));
      }, tool.timeoutMs);
    });
    try {
      return await Promise.race([tool.execute(input, { ...context, signal: controller.signal }), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
