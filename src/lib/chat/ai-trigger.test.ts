import { beforeEach, describe, expect, it, vi } from "vitest";

const processAiRun = vi.fn();
const recoverPendingAiRuns = vi.fn();

vi.mock("@/lib/ai/service", () => ({ processAiRun, recoverPendingAiRuns }));

describe("AI trigger", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    processAiRun.mockResolvedValue(undefined);
    recoverPendingAiRuns.mockResolvedValue(0);
  });

  it("waits for the requested run to finish", async () => {
    processAiRun.mockResolvedValue(undefined);
    const { triggerAiRun } = await import("./ai-trigger");

    await triggerAiRun("run-1");

    expect(processAiRun).toHaveBeenCalledOnce();
    expect(processAiRun).toHaveBeenCalledWith("run-1");
  });

  it("performs one recovery scan without starting the development timer in tests", async () => {
    const { ensureAiWorker } = await import("./ai-trigger");

    ensureAiWorker();
    await Promise.resolve();

    expect(recoverPendingAiRuns).toHaveBeenCalledOnce();
  });
});
