import { describe, expect, it } from "vitest";
import { canMoveRunBetweenRuntimes, runtimeRolloutConfig, selectRolloutMode } from "./rollout";

describe("runtime rollout", () => {
  it("targets rooms and agents while leaving unmatched traffic on legacy", () => {
    const config = runtimeRolloutConfig({ AGENT_RUNTIME_CANARY_MODE: "embedded", AGENT_RUNTIME_CANARY_PERCENT: "0", AGENT_RUNTIME_CANARY_ROOM_IDS: "room-a", AGENT_RUNTIME_CANARY_AGENT_IDS: "agent-a" });
    expect(selectRolloutMode({ roomId: "room-a" }, config)).toBe("embedded");
    expect(selectRolloutMode({ roomId: "room-b", agentId: "agent-a" }, config)).toBe("embedded");
    expect(selectRolloutMode({ roomId: "room-b" }, config)).toBe("legacy");
  });

  it("uses deterministic percentage assignment and rejects unsafe continuation", () => {
    const config = runtimeRolloutConfig({ AGENT_RUNTIME_CANARY_MODE: "self_hosted", AGENT_RUNTIME_CANARY_PERCENT: "50" });
    expect(selectRolloutMode({ roomId: "stable-room" }, config)).toBe(selectRolloutMode({ roomId: "stable-room" }, config));
    expect(canMoveRunBetweenRuntimes({ toolCallCount: 0, status: "PENDING" })).toBe(true);
    expect(canMoveRunBetweenRuntimes({ toolCallCount: 1, status: "FAILED_RETRYABLE" })).toBe(false);
  });
});
