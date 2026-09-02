import { describe, expect, it, vi } from "vitest";
import { SelfHostedRuntimeWorker, type ClaimedRun, type RuntimeWorkerStore } from "./self-hosted-worker";

const options = { runtimeId: "runtime-1", version: "test", concurrency: 1, scanIntervalMs: 5, leaseMs: 100, heartbeatMs: 5, inactivityTimeoutMs: 1000, maxRunTimeMs: 2000 };

function store(overrides: Partial<RuntimeWorkerStore> = {}): RuntimeWorkerStore {
  return {
    registerRuntime: vi.fn(async () => undefined),
    claim: vi.fn(async () => []),
    heartbeat: vi.fn(async () => "ACTIVE" as const),
    finishRuntime: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("SelfHostedRuntimeWorker", () => {
  it("recovers work through periodic scanning and enforces concurrency", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const run: ClaimedRun = { id: "run-1", owner: "runtime-1:1", leaseGeneration: 1 };
    const backing = store({ claim: vi.fn(async () => [run]) });
    const execute = vi.fn(async () => gate);
    const worker = new SelfHostedRuntimeWorker(backing, execute, options);
    expect(await worker.scan()).toBe(1);
    expect(await worker.scan()).toBe(0);
    expect(execute).toHaveBeenCalledOnce();
    release();
    await worker.stop();
  });

  it("aborts execution when cancellation is observed by heartbeat", async () => {
    const run: ClaimedRun = { id: "run-1", owner: "owner", leaseGeneration: 2 };
    const backing = store({ claim: vi.fn(async () => [run]), heartbeat: vi.fn(async () => "CANCEL" as const) });
    let reason = "";
    const execute = vi.fn(async (_run, { signal }) => new Promise<void>((resolve) => signal.addEventListener("abort", () => {
      reason = (signal.reason as Error).message;
      resolve();
    }, { once: true })));
    const worker = new SelfHostedRuntimeWorker(backing, execute, options);
    await worker.scan();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await worker.stop();
    expect(reason).toBe("run_cancelled");
  });

  it("aborts immediately after lease loss", async () => {
    const run: ClaimedRun = { id: "run-1", owner: "owner", leaseGeneration: 2 };
    const backing = store({ claim: vi.fn(async () => [run]), heartbeat: vi.fn(async () => "LEASE_LOST" as const) });
    let aborted = false;
    const worker = new SelfHostedRuntimeWorker(backing, async (_run, { signal }) => new Promise<void>((resolve) => signal.addEventListener("abort", () => { aborted = true; resolve(); })), options);
    await worker.scan();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await worker.stop();
    expect(aborted).toBe(true);
  });
});
