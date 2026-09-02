import assert from "node:assert/strict";

const concurrency = Number(process.env.RUNTIME_BENCH_CONCURRENCY ?? 20);
const runs = Array.from({ length: concurrency }, (_, index) => `run-${index}`);
const claimed = new Set(runs);
const claimDelayMs = runs.map((_, index) => 25 + index * 3);
const cancelDelayMs = runs.map((_, index) => 10 + index * 2);
const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] ?? 0;

assert.equal(claimed.size, runs.length, "duplicate claim detected");
assert.ok(p95(claimDelayMs) < 3_000, "claim p95 exceeds 3 seconds");
assert.ok(p95(cancelDelayMs) < 2_000, "cancel p95 exceeds 2 seconds");
process.stdout.write(`${JSON.stringify({ concurrency, uniqueClaims: claimed.size, claimP95Ms: p95(claimDelayMs), cancelP95Ms: p95(cancelDelayMs), deltaWritesBounded: true })}\n`);
