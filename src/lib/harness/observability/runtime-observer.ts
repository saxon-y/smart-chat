import type { Usage } from "../protocol";
import { StructuredLogger } from "./logger";
import { RuntimeMetrics } from "./metrics";

export class RuntimeObserver {
  constructor(readonly logger: StructuredLogger, readonly metrics: RuntimeMetrics) {}

  async latency(name: "run_latency_ms" | "turn_latency_ms" | "tool_latency_ms" | "first_token_latency_ms", value: number, runId: string, extra: { turnIndex?: number; toolCallId?: string } = {}) {
    await this.metrics.record(name, Math.max(0, value), { runId, ...extra });
  }

  async usage(runId: string, usage: Usage, turnIndex?: number) {
    const correlation = { runId, turnIndex };
    await Promise.all([
      this.metrics.record("input_tokens", usage.inputTokens, correlation),
      this.metrics.record("output_tokens", usage.outputTokens, correlation),
      this.metrics.record("cost_micros", usage.costMicros ?? 0, correlation),
    ]);
  }
}
