import type { AiRunStatus } from "@prisma/client";

export type AgentStatusValue = AiRunStatus | string;

export type AgentRunForTimeline = {
  status?: AgentStatusValue | null;
  errorCode?: string | null;
  toolName?: string | null;
  approvalPending?: boolean;
};

export type AgentTimelineTone = "neutral" | "active" | "success" | "warning" | "danger";

export type AgentTimelineItem = {
  id: string;
  label: string;
  detail?: string;
  tone: AgentTimelineTone;
  state: "complete" | "current" | "upcoming";
};

const STATUS_LABELS: Record<string, { label: string; tone: AgentTimelineTone }> = {
  PENDING: { label: "排队中", tone: "neutral" },
  PREPARING: { label: "读取上下文", tone: "active" },
  READY: { label: "准备执行", tone: "neutral" },
  CLAIMED: { label: "已接手任务", tone: "active" },
  RUNNING: { label: "正在生成", tone: "active" },
  WAITING_APPROVAL: { label: "等待审批", tone: "warning" },
  PAUSED: { label: "已暂停，等待恢复", tone: "warning" },
  RETRY_WAIT: { label: "准备重试", tone: "warning" },
  BLOCKED: { label: "需要处理", tone: "warning" },
  SUCCEEDED: { label: "已完成", tone: "success" },
  NO_ACTION: { label: "已完成，无需回复", tone: "success" },
  CANCELLED: { label: "已取消", tone: "neutral" },
  FAILED_RETRYABLE: { label: "暂时失败，可重试", tone: "danger" },
  FAILED_FINAL: { label: "执行失败", tone: "danger" },
};

const ERROR_MESSAGES: Record<string, string> = {
  provider_outcome_unknown: "服务响应超时，结果尚未确认。",
  provider_api_key_missing: "服务暂时未配置完成。",
  provider_http_429: "服务当前较忙，请稍后重试。",
  provider_http_500: "服务暂时不可用，请稍后重试。",
  provider_http_502: "服务暂时不可用，请稍后重试。",
  provider_http_503: "服务暂时不可用，请稍后重试。",
  cancelled_by_user: "已根据你的请求停止。",
  run_cancelled: "已根据你的请求停止。",
  tool_approval_required: "该操作需要你的确认。",
  non_idempotent_outcome_unknown: "操作结果需要人工确认。",
};

function normalizeStatus(status?: AgentStatusValue | null) {
  return String(status ?? "PENDING").trim().toUpperCase();
}

/** Exposes stable, user-facing copy without leaking internal error details. */
export function describeAgentStatus(status?: AgentStatusValue | null, errorCode?: string | null) {
  const key = normalizeStatus(status);
  const known = STATUS_LABELS[key];
  if (known) return { ...known, errorMessage: errorCode ? ERROR_MESSAGES[errorCode] : undefined };
  if (["TOOL", "TOOL_CALL", "TOOL_RUNNING"].includes(key)) return { label: "正在调用工具", tone: "active" as const, errorMessage: undefined };
  if (["TOOL_SUCCEEDED", "TOOL_RESULT"].includes(key)) return { label: "工具已完成", tone: "success" as const, errorMessage: undefined };
  if (["TOOL_FAILED", "ERROR"].includes(key)) return { label: "工具调用失败", tone: "danger" as const, errorMessage: "工具暂时无法完成，请稍后重试。" };
  return { label: "处理中", tone: "active" as const, errorMessage: undefined };
}

const ORDER = ["PENDING", "PREPARING", "READY", "CLAIMED", "RUNNING", "SUCCEEDED"];

/** Builds a compact lifecycle timeline while keeping the current state stable. */
export function buildAgentTimeline(run: AgentRunForTimeline): AgentTimelineItem[] {
  const status = normalizeStatus(run.status);
  const description = describeAgentStatus(status, run.errorCode);
  const terminal = ["SUCCEEDED", "NO_ACTION", "CANCELLED", "FAILED_RETRYABLE", "FAILED_FINAL", "BLOCKED"].includes(status);
  const currentIndex = ORDER.indexOf(status);
  const effectiveIndex = currentIndex >= 0 ? currentIndex : ["WAITING_APPROVAL", "PAUSED", "RETRY_WAIT", "BLOCKED"].includes(status) ? 4 : 0;
  const items: AgentTimelineItem[] = [
    { id: "queued", label: "排队中", tone: "neutral", state: effectiveIndex > 0 || terminal ? "complete" : status === "PENDING" ? "current" : "upcoming" },
    { id: "context", label: "读取上下文", tone: "active", state: effectiveIndex > 1 || terminal ? "complete" : status === "PREPARING" ? "current" : "upcoming" },
    ...(run.toolName || ["WAITING_APPROVAL", "TOOL", "TOOL_CALL", "TOOL_RUNNING", "TOOL_SUCCEEDED", "TOOL_RESULT", "TOOL_FAILED"].includes(status)
      ? [{ id: "tool", label: run.approvalPending || status === "WAITING_APPROVAL" ? "等待审批" : run.toolName ? `调用工具：${run.toolName}` : "调用工具", tone: (run.approvalPending || status === "WAITING_APPROVAL" ? "warning" : "active") as AgentTimelineTone, state: (status === "WAITING_APPROVAL" || status.startsWith("TOOL") ? "current" : "upcoming") as AgentTimelineItem["state"] }]
      : []),
    { id: "generate", label: "生成回复", tone: "active", state: status === "RUNNING" ? "current" : status === "SUCCEEDED" || status === "NO_ACTION" ? "complete" : "upcoming" },
    { id: "result", label: description.label, detail: description.errorMessage, tone: description.tone, state: terminal ? "current" : "upcoming" },
  ];
  if (["PAUSED", "RETRY_WAIT", "BLOCKED", "CANCELLED", "FAILED_RETRYABLE", "FAILED_FINAL", "NO_ACTION"].includes(status)) {
    return items.map((item) => item.id === "result" ? item : { ...item, state: "complete" as const }).map((item) => item.id === "result" ? { ...item, detail: description.errorMessage ?? (status === "PAUSED" ? "可以稍后恢复。" : status === "RETRY_WAIT" ? "将自动再次尝试。" : status === "BLOCKED" ? "完成必要处理后可以重试。" : undefined) } : item);
  }
  return items;
}
