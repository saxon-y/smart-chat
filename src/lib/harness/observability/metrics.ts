import type { CorrelationFields } from "./logger";

export const RUNTIME_METRICS = [
  "queue_delay_ms",
  "run_latency_ms",
  "turn_latency_ms",
  "tool_latency_ms",
  "first_token_latency_ms",
  "input_tokens",
  "output_tokens",
  "cost_micros",
  "approval_wait_ms",
  "lease_lost_total",
  "recovery_total",
  "context_compression_total",
] as const;

export type RuntimeMetricName = typeof RUNTIME_METRICS[number];

export interface MetricPoint extends CorrelationFields {
  name: RuntimeMetricName;
  value: number;
  timestamp: string;
  labels?: Readonly<Record<string, string>>;
}

export interface MetricsSink { record(point: MetricPoint): void | Promise<void> }

export class RuntimeMetrics {
  constructor(private readonly sink: MetricsSink) {}

  record(name: RuntimeMetricName, value: number, correlation: CorrelationFields = {}, labels?: Record<string, string>) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`invalid_metric_value:${name}`);
    const point: MetricPoint = { name, value, timestamp: new Date().toISOString(), ...correlation, ...(labels ? { labels } : {}) };
    return this.sink.record(point);
  }

  increment(name: Extract<RuntimeMetricName, `${string}_total`>, correlation: CorrelationFields = {}, labels?: Record<string, string>) {
    return this.record(name, 1, correlation, labels);
  }
}

export class InMemoryMetricsSink implements MetricsSink {
  readonly points: MetricPoint[] = [];
  record(point: MetricPoint) { this.points.push(point); }
}
