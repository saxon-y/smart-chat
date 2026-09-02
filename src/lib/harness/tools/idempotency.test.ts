import { describe, expect, it } from "vitest";
import { argumentsDigest, createToolIdempotencyKey, decideToolRecovery } from "./idempotency";

describe("tool idempotency decisions", () => {
  it("creates stable keys while argument changes create a new key", () => {
    const first = argumentsDigest({ b: 2, a: 1 });
    expect(first).toBe(argumentsDigest({ a: 1, b: 2 }));
    expect(createToolIdempotencyKey("run", "call", first)).toBe(`run:call:${first}`);
    expect(argumentsDigest({ a: 2 })).not.toBe(first);
  });

  it("returns committed results and never replays unknown non-idempotent effects", () => {
    expect(decideToolRecovery("READ_ONLY", "SUCCEEDED")).toBe("RETURN_RECORDED_RESULT");
    expect(decideToolRecovery("KEYED", "OUTCOME_UNKNOWN")).toBe("RETRY_WITH_SAME_KEY");
    expect(decideToolRecovery("NON_IDEMPOTENT", "OUTCOME_UNKNOWN")).toBe("BLOCK_FOR_REVIEW");
    expect(decideToolRecovery("READ_ONLY", "PENDING")).toBe("WAIT_FOR_IN_FLIGHT");
  });
});
