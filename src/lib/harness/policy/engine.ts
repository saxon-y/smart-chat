import type { ExecutionPolicy } from "../protocol/policy";
import { argumentsDigest } from "../tools/idempotency";
import type { RegisteredTool } from "../tools/types";

export type PolicyDecision = "ALLOW" | "DENY" | "REQUIRE_APPROVAL";
export type PolicyCheck = "skill_dependency" | "agent_capability" | "member_permission" | "argument_boundary" | "schema_digest" | "risk" | "host" | "budget";

export interface PolicyAuditEntry {
  check: PolicyCheck;
  passed: boolean;
  reason: string;
}

export interface ToolPolicyRequest {
  tool: RegisteredTool;
  policy: ExecutionPolicy;
  arguments: unknown;
  expectedSchemaDigest: string;
  skillAllowedTools: ReadonlySet<string>;
  agentCapabilities: ReadonlySet<string>;
  /** Must query current authorization immediately before execution. */
  checkMemberPermission(): boolean | Promise<boolean>;
  checkArgumentBoundary(argumentsValue: unknown): boolean | Promise<boolean>;
  targetHost?: string;
  remainingToolCalls: number;
  remainingWallTimeMs: number;
  approvedArgumentsDigest?: string;
}

export interface ToolPolicyResult {
  decision: PolicyDecision;
  reason: string;
  audit: readonly PolicyAuditEntry[];
}

function normalizedHost(value: string): string | undefined {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function hostAllowed(target: string | undefined, allowedHosts: readonly string[]) {
  if (!target) return true;
  const host = normalizedHost(target);
  if (!host) return false;
  return allowedHosts.some((allowed) => normalizedHost(allowed) === host);
}

export class ToolPolicyEngine {
  async evaluate(request: ToolPolicyRequest): Promise<ToolPolicyResult> {
    const audit: PolicyAuditEntry[] = [];
    const check = (name: PolicyCheck, passed: boolean, reason: string) => {
      audit.push({ check: name, passed, reason });
      return passed;
    };
    const denied = (reason: string): ToolPolicyResult => ({ decision: "DENY", reason, audit });

    const explicitlyDenied = request.policy.deniedTools.includes(request.tool.id);
    const skillPermits = request.skillAllowedTools.has(request.tool.id)
      && request.policy.allowedTools.includes(request.tool.id)
      && !explicitlyDenied;
    if (!check("skill_dependency", skillPermits, explicitlyDenied ? "tool_explicitly_denied" : skillPermits ? "skill_and_policy_allow_tool" : "tool_not_allowed_by_skill_or_policy")) {
      return denied(audit.at(-1)!.reason);
    }

    const missingCapability = request.tool.requiredCapabilities.find((capability) => !request.agentCapabilities.has(capability));
    if (!check("agent_capability", !missingCapability, missingCapability ? `agent_capability_missing:${missingCapability}` : "agent_capabilities_satisfied")) {
      return denied(audit.at(-1)!.reason);
    }

    const memberPermitted = await request.checkMemberPermission();
    if (!check("member_permission", memberPermitted, memberPermitted ? "member_permission_current" : "member_permission_denied")) {
      return denied("member_permission_denied");
    }

    const argumentsValid = await request.checkArgumentBoundary(request.arguments);
    if (!check("argument_boundary", argumentsValid, argumentsValid ? "arguments_within_boundary" : "argument_boundary_violation")) {
      return denied("argument_boundary_violation");
    }

    const digestMatches = request.expectedSchemaDigest === request.tool.schemaDigest;
    if (!check("schema_digest", digestMatches, digestMatches ? "schema_digest_matches" : "tool_schema_digest_mismatch")) {
      return denied("tool_schema_digest_mismatch");
    }

    const approvalRequired = request.tool.risk === "DESTRUCTIVE" || request.policy.approvalTools.includes(request.tool.id);
    const riskPermitted = !approvalRequired || request.approvedArgumentsDigest === argumentsDigest(request.arguments);
    check("risk", riskPermitted, riskPermitted ? "risk_permitted" : "tool_approval_required");

    const allowedHost = hostAllowed(request.targetHost, request.policy.allowedHosts);
    if (!check("host", allowedHost, allowedHost ? "host_allowed" : "host_not_allowed")) return denied("host_not_allowed");

    const budgetAvailable = request.remainingToolCalls > 0 && request.remainingWallTimeMs > 0;
    if (!check("budget", budgetAvailable, budgetAvailable ? "budget_available" : "tool_budget_exhausted")) return denied("tool_budget_exhausted");

    if (!riskPermitted) return { decision: "REQUIRE_APPROVAL", reason: "tool_approval_required", audit };
    return { decision: "ALLOW", reason: "policy_checks_passed", audit };
  }
}
