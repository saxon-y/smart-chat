import { describe, expect, it } from "vitest";
import { buildAgentTimeline, describeAgentStatus } from "./agent-status";

describe("agent status presentation", () => {
  it("maps every persisted run status to explicit user copy", () => {
    const statuses = ["PENDING", "PREPARING", "READY", "CLAIMED", "RUNNING", "WAITING_APPROVAL", "PAUSED", "RETRY_WAIT", "BLOCKED", "SUCCEEDED", "NO_ACTION", "CANCELLED", "FAILED_RETRYABLE", "FAILED_FINAL"];
    for (const status of statuses) expect(describeAgentStatus(status).label).not.toBe("处理中");
  });

  it("keeps internal errors out of the browser-facing copy", () => {
    const result = describeAgentStatus("FAILED_FINAL", "provider_http_503: secret=do-not-show");
    expect(result.errorMessage).toBeUndefined();
    expect(JSON.stringify(buildAgentTimeline({ status: "FAILED_FINAL", errorCode: "provider_http_503: secret=do-not-show" }))).not.toContain("secret");
  });

  it("shows approval, recovery, cancellation and retry semantics", () => {
    expect(buildAgentTimeline({ status: "WAITING_APPROVAL", approvalPending: true }).map((item) => item.label)).toContain("等待审批");
    expect(buildAgentTimeline({ status: "PAUSED" }).at(-1)?.detail).toContain("恢复");
    expect(buildAgentTimeline({ status: "RETRY_WAIT" }).at(-1)?.detail).toContain("自动");
    expect(buildAgentTimeline({ status: "CANCELLED", errorCode: "cancelled_by_user" }).at(-1)?.detail).toContain("停止");
    expect(buildAgentTimeline({ status: "RUNNING", toolName: "search" }).map((item) => item.label)).toContain("调用工具：search");
  });
});
