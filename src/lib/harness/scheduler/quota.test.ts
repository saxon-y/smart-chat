import { describe, expect, it } from "vitest";
import { InMemoryQuotaCoordinator, type ConcurrencyPolicy, type QuotaRequest } from "./quota";

const policy: ConcurrencyPolicy = {
  global: 3,
  perRoom: 2,
  perUser: 2,
  perAgent: 2,
  perProvider: 2,
  perRuntime: 2,
  perMcpServer: 1,
  maxQueue: 20,
};

const request: QuotaRequest = {
  roomId: "room-a",
  userId: "user-a",
  agentId: "agent-a",
  providerId: "provider-a",
  runtimeId: "runtime-a",
  mcpServerIds: ["crm"],
};

describe("in-memory multidimensional quota coordinator", () => {
  it("claims every dimension atomically and releases idempotently", () => {
    const coordinator = new InMemoryQuotaCoordinator(policy);
    const first = coordinator.tryAcquire(request)!;
    expect(coordinator.tryAcquire({ ...request, roomId: "room-b" })).toBeUndefined();
    expect(coordinator.snapshot().get("room:room-b")).toBeUndefined();
    first.release();
    first.release();
    expect([...coordinator.snapshot()]).toEqual([]);
  });

  it("enforces supervisor serialization per room", () => {
    const coordinator = new InMemoryQuotaCoordinator({ ...policy, perMcpServer: 3 });
    const first = coordinator.tryAcquire({ ...request, supervisor: true })!;
    expect(coordinator.tryAcquire({ ...request, agentId: "agent-b", supervisor: true })).toBeUndefined();
    expect(coordinator.tryAcquire({ ...request, roomId: "room-b", supervisor: true })).toBeDefined();
    first.release();
  });

  it("bounds the waiter queue and removes aborted waiters", async () => {
    const coordinator = new InMemoryQuotaCoordinator({ ...policy, global: 1, maxQueue: 1 });
    const lease = coordinator.tryAcquire(request)!;
    const abort = new AbortController();
    const waiting = coordinator.acquire({ ...request, mcpServerIds: [] }, abort.signal);
    await expect(coordinator.acquire({ ...request, roomId: "room-b", mcpServerIds: [] })).rejects.toThrow("quota_queue_full");
    abort.abort();
    await expect(waiting).rejects.toThrow("quota_acquire_aborted");
    lease.release();
    expect([...coordinator.snapshot()]).toEqual([]);
  });

  it("never exceeds any requested dimension under concurrent load", async () => {
    const coordinator = new InMemoryQuotaCoordinator({ ...policy, global: 4, perRoom: 2, perMcpServer: 2, maxQueue: 100 });
    const peaks = new Map<string, number>();
    const jobs = Array.from({ length: 24 }, async (_, index) => {
      const current = { ...request, roomId: `room-${index % 3}`, userId: `user-${index % 4}`, mcpServerIds: [`mcp-${index % 2}`] };
      const lease = await coordinator.acquire(current);
      for (const [key, value] of coordinator.snapshot()) peaks.set(key, Math.max(peaks.get(key) ?? 0, value));
      await Promise.resolve();
      lease.release();
    });
    await Promise.all(jobs);
    expect(peaks.get("global")).toBeLessThanOrEqual(4);
    for (const [key, peak] of peaks) {
      if (key.startsWith("room:")) expect(peak).toBeLessThanOrEqual(2);
      if (key.startsWith("mcp:")) expect(peak).toBeLessThanOrEqual(2);
    }
    expect([...coordinator.snapshot()]).toEqual([]);
  });
});
