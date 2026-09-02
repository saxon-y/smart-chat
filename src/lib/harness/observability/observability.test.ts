import { describe, expect, it, vi } from "vitest";
import { InMemoryMetricsSink, redact, RuntimeMetrics, RuntimeObserver, StructuredLogger } from ".";

describe("structured observability", () => {
  it("redacts sensitive keys and secrets nested in values", () => {
    const value = redact({
      authorization: "Bearer visible-secret",
      nested: { apiKey: "sk-example123456789", note: "use Bearer abc.def.ghi" },
      items: [{ password: "plain" }],
    });
    expect(value).toEqual({
      authorization: "[REDACTED]",
      nested: { apiKey: "[REDACTED]", note: "use Bearer [REDACTED]" },
      items: [{ password: "[REDACTED]" }],
    });
  });

  it("emits correlation fields without leaking log payload secrets", () => {
    const sink = vi.fn();
    const entry = new StructuredLogger(sink).log("info", "tool.completed", { runId: "run-1", toolCallId: "call-1", leaseGeneration: 3 }, { token: "secret" });
    expect(sink).toHaveBeenCalledOnce();
    expect(entry).toMatchObject({ event: "tool.completed", runId: "run-1", toolCallId: "call-1", leaseGeneration: 3, fields: { token: "[REDACTED]" } });
  });

  it("records required metrics with correlation fields and rejects invalid values", () => {
    const sink = new InMemoryMetricsSink();
    const metrics = new RuntimeMetrics(sink);
    metrics.record("first_token_latency_ms", 42, { runId: "run-1", turnIndex: 2 });
    metrics.increment("lease_lost_total", { runId: "run-1", runtimeId: "runtime-1" });
    expect(sink.points).toMatchObject([
      { name: "first_token_latency_ms", value: 42, runId: "run-1", turnIndex: 2 },
      { name: "lease_lost_total", value: 1, runId: "run-1", runtimeId: "runtime-1" },
    ]);
    expect(() => metrics.record("cost_micros", -1)).toThrow("invalid_metric_value:cost_micros");
  });

  it("records lifecycle latency and usage with run and turn correlation", async () => {
    const sink = new InMemoryMetricsSink();
    const observer = new RuntimeObserver(new StructuredLogger(() => undefined), new RuntimeMetrics(sink));
    await observer.latency("turn_latency_ms", 18, "run-2", { turnIndex: 3 });
    await observer.usage("run-2", { inputTokens: 10, outputTokens: 4, costMicros: 2 }, 3);
    expect(sink.points).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "turn_latency_ms", value: 18, runId: "run-2", turnIndex: 3 }),
      expect.objectContaining({ name: "input_tokens", value: 10, runId: "run-2", turnIndex: 3 }),
      expect.objectContaining({ name: "output_tokens", value: 4, runId: "run-2", turnIndex: 3 }),
      expect.objectContaining({ name: "cost_micros", value: 2, runId: "run-2", turnIndex: 3 }),
    ]));
  });
});
