import { describe, expect, it } from "vitest";
import { buildSupervisorPrompt, validateRoutingDecision, type RoutingCandidate } from "./routing";

const candidates: RoutingCandidate[] = [
  { memberId: "portrait-member", agentKey: "portrait", name: "人像师", capabilities: ["image.portrait"] },
];

describe("supervisor routing", () => {
  it("accepts an allowlisted target with a matching capability", () => {
    expect(validateRoutingDecision(JSON.stringify({
      action: "DELEGATE",
      targetMemberId: "portrait-member",
      capability: "image.portrait",
      confidence: 0.92,
      reasonCode: "PORTRAIT_REQUEST",
    }), candidates, 0.75)).toEqual({
      action: "DELEGATE",
      targetMemberId: "portrait-member",
      capability: "image.portrait",
      confidence: 0.92,
      reasonCode: "PORTRAIT_REQUEST",
    });
  });

  it("fails closed for unknown targets, mismatched capabilities and malformed output", () => {
    const unknown = JSON.stringify({ action: "DELEGATE", targetMemberId: "other-room", capability: "image.portrait", confidence: 1, reasonCode: "REQUEST" });
    const mismatch = JSON.stringify({ action: "DELEGATE", targetMemberId: "portrait-member", capability: "image.comic", confidence: 1, reasonCode: "REQUEST" });
    expect(validateRoutingDecision(unknown, candidates, 0.75).action).toBe("NO_ACTION");
    expect(validateRoutingDecision(mismatch, candidates, 0.75).action).toBe("NO_ACTION");
    expect(validateRoutingDecision("not-json", candidates, 0.75).action).toBe("NO_ACTION");
  });

  it("does not delegate below the configured confidence threshold", () => {
    const result = validateRoutingDecision(JSON.stringify({ action: "DELEGATE", targetMemberId: "portrait-member", capability: "image.portrait", confidence: 0.5, reasonCode: "MAYBE" }), candidates, 0.75);
    expect(result).toEqual({ action: "NO_ACTION", confidence: 0.5, reasonCode: "BELOW_CONFIDENCE_THRESHOLD" });
  });

  it("accepts a JSON decision wrapped in a markdown json fence", () => {
    const fenced = "```json\n" + JSON.stringify({
      action: "DELEGATE",
      targetMemberId: "portrait-member",
      capability: "image.portrait",
      confidence: 0.75,
      reasonCode: "AT_THRESHOLD",
    }) + "\n```";
    const result = validateRoutingDecision(fenced, candidates, 0.75);

    expect(result.action).toBe("DELEGATE");
  });

  it("fails closed when fenced output contains trailing text", () => {
    const result = validateRoutingDecision(
      "```json\n" + JSON.stringify({ action: "NO_ACTION", confidence: 1, reasonCode: "OK" }) + "\n```\nextra",
      candidates,
      0.75,
    );

    expect(result).toEqual({ action: "NO_ACTION", confidence: 0, reasonCode: "INVALID_ROUTER_OUTPUT" });
  });

  it("preserves a valid no-action reason from the supervisor", () => {
    const result = validateRoutingDecision(JSON.stringify({
      action: "NO_ACTION",
      targetMemberId: null,
      confidence: 0.88,
      reasonCode: "GENERAL_CHAT",
    }), candidates, 0.75);

    expect(result).toEqual({ action: "NO_ACTION", confidence: 0.88, reasonCode: "GENERAL_CHAT" });
  });

  it("fails closed when a delegate decision omits its capability", () => {
    const result = validateRoutingDecision(JSON.stringify({
      action: "DELEGATE",
      targetMemberId: "portrait-member",
      confidence: 0.99,
      reasonCode: "REQUEST",
    }), candidates, 0.75);

    expect(result).toEqual({ action: "NO_ACTION", confidence: 0.99, reasonCode: "INVALID_ROUTING_TARGET" });
  });

  it("includes only stable candidate fields in the supervisor prompt", () => {
    const prompt = buildSupervisorPrompt(candidates, 0.75);
    expect(prompt).toContain("portrait-member");
    expect(prompt).toContain("image.portrait");
    expect(prompt).toContain("0.75");
  });
});
