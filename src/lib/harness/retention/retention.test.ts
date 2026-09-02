import { describe, expect, it, vi } from "vitest";
import { cleanupRuntimeRecords, type RetentionPlan, type RetentionStore } from ".";

const now = new Date("2026-09-01T12:00:00.000Z");
const plan: RetentionPlan = {
  cutoff: new Date("2026-08-02T12:00:00.000Z"),
  deltaEvents: [{ id: "event-1", runId: "terminal-run", createdAt: new Date("2026-01-01") }],
  turns: [{ id: "turn-1", runId: "terminal-run", createdAt: new Date("2026-01-01") }],
};

function store(): RetentionStore & { plan: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> } {
  return {
    plan: vi.fn().mockResolvedValue(plan),
    remove: vi.fn().mockResolvedValue({ deltaEvents: 1, turns: 1 }),
  };
}

describe("runtime record retention", () => {
  it("defaults to an exact, non-mutating dry run", async () => {
    const repository = store();
    const summary = await cleanupRuntimeRecords(repository, { retentionDays: 30, now });
    expect(repository.plan).toHaveBeenCalledWith(plan.cutoff);
    expect(repository.remove).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      dryRun: true,
      cutoff: plan.cutoff.toISOString(),
      candidates: { deltaEvents: 1, turns: 1 },
      deleted: { deltaEvents: 0, turns: 0 },
      targetIds: { deltaEvents: ["event-1"], turns: ["turn-1"] },
    });
  });

  it("deletes only the previously planned targets when explicitly enabled", async () => {
    const repository = store();
    const summary = await cleanupRuntimeRecords(repository, { retentionDays: 30, dryRun: false, now });
    expect(repository.remove).toHaveBeenCalledWith(plan);
    expect(summary.deleted).toEqual({ deltaEvents: 1, turns: 1 });
  });

  it("rejects ambiguous retention periods before querying", async () => {
    const repository = store();
    await expect(cleanupRuntimeRecords(repository, { retentionDays: 0 })).rejects.toThrow("retention_days_must_be_a_positive_integer");
    expect(repository.plan).not.toHaveBeenCalled();
  });
});
