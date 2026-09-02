import { describe, expect, it, vi } from "vitest";
import { DeltaAggregator } from "./delta-aggregator";

describe("DeltaAggregator", () => {
  it("flushes at 4 KiB and preserves exact text", async () => {
    const sink = vi.fn();
    const aggregator = new DeltaAggregator(sink);
    await aggregator.push("x".repeat(4095), 0);
    expect(sink).not.toHaveBeenCalled();
    await aggregator.push("y", 1);
    expect(sink).toHaveBeenCalledWith({ text: `${"x".repeat(4095)}y`, byteLength: 4096 });
  });

  it("flushes after the configured time window", async () => {
    const sink = vi.fn();
    const aggregator = new DeltaAggregator(sink, { maxDelayMs: 100 });
    await aggregator.push("a", 10);
    await aggregator.push("b", 110);
    expect(sink).toHaveBeenCalledWith({ text: "ab", byteLength: 2 });
  });

  it("discards an unfinished batch", async () => {
    const sink = vi.fn();
    const aggregator = new DeltaAggregator(sink);
    await aggregator.push("partial", 0);
    aggregator.discard();
    await aggregator.flush();
    expect(sink).not.toHaveBeenCalled();
  });
});
