"use client";

import { Ban, Check, CircleAlert, CircleDot, LoaderCircle, RefreshCw } from "lucide-react";
import { buildAgentTimeline, type AgentRunForTimeline } from "@/lib/chat/agent-status";

export type AgentRunTimelineProps = AgentRunForTimeline & {
  agentName?: string | null;
  onRetry?: () => void;
  onCancel?: () => void;
};

export function AgentRunTimeline({ agentName, onRetry, onCancel, ...run }: AgentRunTimelineProps) {
  const items = buildAgentTimeline(run);
  const status = String(run.status ?? "PENDING").toUpperCase();
  const retryable = ["FAILED_RETRYABLE", "FAILED_FINAL", "CANCELLED", "BLOCKED"].includes(status);
  const cancellable = ["PENDING", "PREPARING", "READY", "CLAIMED", "RUNNING", "WAITING_APPROVAL", "PAUSED", "RETRY_WAIT"].includes(status);
  return (
    <section className="agent-run-timeline" aria-label={`${agentName ?? "助手"}处理进度`}>
      <ol>
        {items.map((item) => (
          <li key={item.id} className={`agent-timeline-item is-${item.state} tone-${item.tone}`}>
            <span className="agent-timeline-marker" aria-hidden="true">
              {item.state === "current" && item.tone === "active" ? <LoaderCircle size={14} className="spin" /> : item.state === "complete" ? <Check size={14} /> : item.tone === "danger" ? <CircleAlert size={14} /> : <CircleDot size={14} />}
            </span>
            <span className="agent-timeline-copy"><strong>{item.label}</strong>{item.detail && <small>{item.detail}</small>}</span>
          </li>
        ))}
      </ol>
      {(retryable || cancellable) && <div className="agent-timeline-actions">
        {retryable && onRetry && <button type="button" onClick={onRetry} aria-label="重试" title="重试"><RefreshCw size={13} /> 重试</button>}
        {cancellable && onCancel && <button type="button" onClick={onCancel} aria-label="取消" title="取消"><Ban size={13} /> 取消</button>}
      </div>}
    </section>
  );
}

export default AgentRunTimeline;
