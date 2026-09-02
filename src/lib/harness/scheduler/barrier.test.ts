import { describe, expect, it } from "vitest";
import { decideBarrier, type BarrierChild, type FailurePolicy } from "./barrier";

function child(runId: string, state: BarrierChild["state"], failurePolicy: FailurePolicy = "FAIL_FAST"): BarrierChild {
  return { runId, state, failurePolicy };
}

describe("barrier decisions", () => {
  it("waits for ALL and aggregates after every required child succeeds", () => {
    expect(decideBarrier({ type: "ALL" }, [child("a", "SUCCEEDED"), child("b", "RUNNING")])).toEqual({ action: "WAIT" });
    expect(decideBarrier({ type: "ALL" }, [child("a", "SUCCEEDED"), child("b", "SUCCEEDED")])).toMatchObject({ action: "AGGREGATE" });
  });

  it("allows ANY to aggregate on the first success", () => {
    expect(decideBarrier({ type: "ANY" }, [child("a", "FAILED", "CONTINUE"), child("b", "SUCCEEDED")])).toMatchObject({
      action: "AGGREGATE",
      successfulRunIds: ["b"],
      failedRunIds: ["a"],
    });
  });

  it("waits for QUORUM while attainable and fails when it becomes impossible", () => {
    expect(decideBarrier({ type: "QUORUM", minimum: 2 }, [child("a", "SUCCEEDED"), child("b", "RUNNING"), child("c", "FAILED", "CONTINUE")])).toEqual({ action: "WAIT" });
    expect(decideBarrier({ type: "QUORUM", minimum: 2 }, [child("a", "SUCCEEDED"), child("b", "SUCCEEDED"), child("c", "RUNNING")])).toMatchObject({ action: "AGGREGATE" });
    expect(decideBarrier({ type: "QUORUM", minimum: 2 }, [child("a", "SUCCEEDED"), child("b", "FAILED", "CONTINUE")])).toMatchObject({ action: "FAIL", reason: "BARRIER_UNSATISFIABLE" });
  });

  it("only releases REQUIRED after named children succeed", () => {
    const children = [child("required", "SUCCEEDED"), child("extra", "RUNNING")];
    expect(decideBarrier({ type: "REQUIRED", runIds: ["required"] }, children)).toMatchObject({ action: "AGGREGATE" });
    expect(() => decideBarrier({ type: "REQUIRED", runIds: ["unknown"] }, children)).toThrow("barrier_missing_required_child");
  });

  it("does not let OPTIONAL failure block ALL", () => {
    expect(decideBarrier({ type: "ALL" }, [child("required", "SUCCEEDED"), child("image", "FAILED", "OPTIONAL")])).toMatchObject({
      action: "AGGREGATE",
      failedRunIds: ["image"],
    });
  });

  it("lets CONTINUE settle ALL with partial results", () => {
    expect(decideBarrier({ type: "ALL" }, [child("a", "SUCCEEDED"), child("b", "FAILED", "CONTINUE")])).toMatchObject({ action: "AGGREGATE" });
  });

  it("fails immediately and cancels unfinished children for FAIL_FAST", () => {
    expect(decideBarrier({ type: "ALL" }, [child("a", "FAILED"), child("b", "READY"), child("c", "RUNNING")])).toEqual({
      action: "FAIL",
      reason: "FAIL_FAST",
      cancelRunIds: ["b", "c"],
    });
  });
});
