export type ApprovalPresentationInput = {
  toolId?: string | null;
  risk?: string | null;
  status?: string | null;
  target?: string | null;
};

const RISK_LABELS: Record<string, string> = {
  READ: "读取信息",
  WRITE: "修改信息",
  DESTRUCTIVE: "高风险操作",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: "等待确认",
  APPROVED: "已批准",
  REJECTED: "已拒绝",
};

function safeToolName(toolId?: string | null) {
  const value = toolId?.trim();
  if (!value) return "一项工具操作";
  const segment = value.split(/[.:/]/).filter(Boolean).at(-1) ?? value;
  return segment.replace(/[^a-zA-Z0-9\u4e00-\u9fff _-]/g, "").slice(0, 80) || "一项工具操作";
}

export function presentApproval(input: ApprovalPresentationInput) {
  const risk = String(input.risk ?? "").toUpperCase();
  const status = String(input.status ?? "PENDING").toUpperCase();
  return {
    toolLabel: safeToolName(input.toolId),
    riskLabel: RISK_LABELS[risk] ?? "需要确认的操作",
    statusLabel: STATUS_LABELS[status] ?? "等待确认",
    targetLabel: input.target?.trim().slice(0, 120) || undefined,
    requiresPrivilege: risk === "WRITE" || risk === "DESTRUCTIVE",
  };
}
