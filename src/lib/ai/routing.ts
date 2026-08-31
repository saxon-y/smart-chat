import { z } from "zod";

export type RoutingCandidate = {
  memberId: string;
  agentKey: string;
  name: string;
  capabilities: string[];
};

const rawRoutingDecisionSchema = z.object({
  action: z.enum(["NO_ACTION", "DELEGATE"]),
  targetMemberId: z.string().nullable().optional(),
  capability: z.string().trim().min(1).nullable().optional(),
  confidence: z.number().min(0).max(1),
  reasonCode: z.string().trim().regex(/^[A-Z0-9_]+$/).max(80),
});

export type RoutingDecision =
  | { action: "NO_ACTION"; confidence: number; reasonCode: string }
  | {
      action: "DELEGATE";
      targetMemberId: string;
      capability: string;
      confidence: number;
      reasonCode: string;
    };

function jsonObjectFromModelOutput(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced?.[1] ?? trimmed);
}

export function validateRoutingDecision(
  content: string,
  candidates: RoutingCandidate[],
  minimumConfidence: number,
): RoutingDecision {
  let parsed: z.infer<typeof rawRoutingDecisionSchema>;
  try {
    parsed = rawRoutingDecisionSchema.parse(jsonObjectFromModelOutput(content));
  } catch {
    return { action: "NO_ACTION", confidence: 0, reasonCode: "INVALID_ROUTER_OUTPUT" };
  }

  if (parsed.action === "NO_ACTION" || parsed.confidence < minimumConfidence) {
    return {
      action: "NO_ACTION",
      confidence: parsed.confidence,
      reasonCode: parsed.action === "NO_ACTION" ? parsed.reasonCode : "BELOW_CONFIDENCE_THRESHOLD",
    };
  }

  const target = candidates.find((candidate) => candidate.memberId === parsed.targetMemberId);
  if (!target || !parsed.capability || !target.capabilities.includes(parsed.capability)) {
    return { action: "NO_ACTION", confidence: parsed.confidence, reasonCode: "INVALID_ROUTING_TARGET" };
  }

  return {
    action: "DELEGATE",
    targetMemberId: target.memberId,
    capability: parsed.capability,
    confidence: parsed.confidence,
    reasonCode: parsed.reasonCode,
  };
}

export function buildSupervisorPrompt(candidates: RoutingCandidate[], minimumConfidence: number) {
  const candidateList = candidates.map(({ memberId, agentKey, name, capabilities }) => ({
    memberId,
    agentKey,
    name,
    capabilities,
  }));
  return [
    "你是聊天室后台总管，只负责决定是否把当前用户消息交给一个专职 Agent。",
    "只能选择候选列表中的 memberId，禁止自行创造 Agent 或跨房间选择。",
    `只有置信度不低于 ${minimumConfidence} 时才 DELEGATE，否则 NO_ACTION。`,
    "仅输出 JSON：{action,targetMemberId,capability,confidence,reasonCode}。",
    `候选列表：${JSON.stringify(candidateList)}`,
  ].join("\n");
}

