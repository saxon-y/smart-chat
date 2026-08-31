import { beforeEach, describe, expect, it, vi } from "vitest";

const { count } = vi.hoisted(() => ({ count: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { aiRun: { count } } }));

import { AiRunRateLimitError, assertAiRunQuota, getAiRunQuota } from "./rate-limit";

describe("AI run quotas", () => {
  beforeEach(() => count.mockReset());

  it("counts user and room runs in the configured rolling window", async () => {
    count.mockResolvedValueOnce(2).mockResolvedValueOnce(4);
    const now = new Date("2026-08-28T12:00:00.000Z");
    const result = await getAiRunQuota({ userId: "u1", roomId: "r1", now, userLimit: 3, roomLimit: 5, imageWindowMs: 60_000 });
    expect(result).toMatchObject({ allowed: true, userCount: 2, roomCount: 4, remaining: 1, roomRemaining: 1, kind: "text" });
    expect(result.windowStart.toISOString()).toBe("2026-08-28T11:59:00.000Z");
    expect(count).toHaveBeenCalledTimes(2);
  });

  it("identifies an image quota using the image agent relation", async () => {
    count.mockResolvedValueOnce(20).mockResolvedValueOnce(1);
    const result = await getAiRunQuota({ userId: "u1", roomId: "r1", kind: "image", now: new Date("2026-08-28T12:00:00.000Z"), userLimit: 20, roomLimit: 50 });
    expect(result.allowed).toBe(false);
    expect(result.resetAt.toISOString()).toBe("2026-08-28T12:00:00.000Z");
    expect(count.mock.calls[0][0].where.targetAgent).toEqual({ is: { kind: "IMAGE" } });
  });

  it("throws a structured 429 when a limit is exceeded", async () => {
    count.mockResolvedValueOnce(3).mockResolvedValueOnce(0);
    await expect(assertAiRunQuota({ userId: "u1", roomId: "r1", userLimit: 3, roomLimit: 10 })).rejects.toSatisfy((error: unknown) => error instanceof AiRunRateLimitError && error.status === 429 && error.code === "AI_RUN_RATE_LIMITED");
  });
});
