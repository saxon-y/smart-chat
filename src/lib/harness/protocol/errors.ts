export type RuntimeErrorCategory = "PROVIDER" | "POLICY" | "TOOL" | "MCP" | "LEASE" | "CONTEXT" | "RUNTIME" | "CANCELLED";
export type RuntimeContinuity = "FULL" | "REBUILT" | "GAP";

const retryableCodes = new Set(["provider_http_429", "provider_http_500", "provider_http_502", "provider_http_503", "provider_http_504", "provider_connection_failed"]);

export class HarnessRuntimeError extends Error {
  constructor(
    readonly code: string,
    readonly category: RuntimeErrorCategory,
    readonly retryable: boolean,
    readonly outcomeKnown: boolean,
    readonly continuity: RuntimeContinuity = "FULL",
    readonly publicMessage = "Agent 执行失败",
  ) {
    super(code);
    this.name = "HarnessRuntimeError";
  }
}

export function classifyRuntimeError(error: unknown): HarnessRuntimeError {
  if (error instanceof HarnessRuntimeError) return error;
  const raw = error instanceof Error ? error.message : "runtime_unknown_error";
  const code = /^[a-z0-9_]+$/.test(raw) ? raw : "runtime_unknown_error";
  if (code === "cancelled_by_user") return new HarnessRuntimeError(code, "CANCELLED", false, true, "FULL", "运行已取消");
  if (code === "run_lease_lost") return new HarnessRuntimeError(code, "LEASE", false, true, "FULL", "运行租约已失效");
  if (code === "context_budget_exceeded") return new HarnessRuntimeError(code, "CONTEXT", false, true, "FULL", "上下文超过预算");
  if (code === "tool_outcome_unknown") return new HarnessRuntimeError(code, "TOOL", false, false, "GAP", "工具执行结果未知，需要人工确认");
  if (code.startsWith("provider_")) return new HarnessRuntimeError(code, "PROVIDER", retryableCodes.has(code), code !== "provider_outcome_unknown", code === "provider_outcome_unknown" ? "REBUILT" : "FULL");
  return new HarnessRuntimeError("runtime_unknown_error", "RUNTIME", false, true);
}
