import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ExecutionPolicy } from "../protocol/policy";
import { ToolRegistry } from "../tools/registry";
import { argumentsDigest } from "../tools/idempotency";
import { ToolPolicyEngine, type ToolPolicyRequest } from "./engine";

const policy: ExecutionPolicy = {
  version: 1,
  allowedTools: ["room.write"],
  deniedTools: [],
  approvalTools: [],
  allowedHosts: ["api.example.com"],
  workspaceRoots: [],
  toolDisclosure: "index",
  skillDisclosure: "catalog",
};

function request(overrides: Partial<ToolPolicyRequest> = {}): ToolPolicyRequest {
  const registry = new ToolRegistry();
  const tool = registry.register({
    id: "room.write",
    version: "1.0.0",
    description: "Write room metadata",
    category: "action",
    inputSchema: z.strictObject({ value: z.string() }),
    inputSchemaDocument: { type: "object", properties: { value: { type: "string" } } },
    risk: "WRITE",
    idempotency: "KEYED",
    timeoutMs: 1_000,
    maxResultBytes: 1_000,
    requiredCapabilities: ["room:write"],
    execute: async () => ({ ok: true }),
  });
  return {
    tool,
    policy,
    arguments: { value: "safe" },
    expectedSchemaDigest: tool.schemaDigest,
    skillAllowedTools: new Set([tool.id]),
    agentCapabilities: new Set(["room:write"]),
    checkMemberPermission: () => true,
    checkArgumentBoundary: () => true,
    targetHost: "https://api.example.com/path",
    remainingToolCalls: 1,
    remainingWallTimeMs: 1_000,
    ...overrides,
  };
}

describe("ToolPolicyEngine", () => {
  it("evaluates every deterministic gate in the documented order", async () => {
    const result = await new ToolPolicyEngine().evaluate(request());
    expect(result.decision).toBe("ALLOW");
    expect(result.audit.map((entry) => entry.check)).toEqual([
      "skill_dependency", "agent_capability", "member_permission", "argument_boundary", "schema_digest", "risk", "host", "budget",
    ]);
  });

  it("gives deniedTools precedence over model-supplied or allowlist input", async () => {
    const result = await new ToolPolicyEngine().evaluate(request({ policy: { ...policy, deniedTools: ["room.write"] } }));
    expect(result).toMatchObject({ decision: "DENY", reason: "tool_explicitly_denied" });
    expect(result.audit).toHaveLength(1);
  });

  it("rechecks current member permission and stops before execution checks", async () => {
    const permission = vi.fn(() => false);
    const boundary = vi.fn(() => true);
    const result = await new ToolPolicyEngine().evaluate(request({ checkMemberPermission: permission, checkArgumentBoundary: boundary }));
    expect(result).toMatchObject({ decision: "DENY", reason: "member_permission_denied" });
    expect(permission).toHaveBeenCalledOnce();
    expect(boundary).not.toHaveBeenCalled();
  });

  it("fails closed for schema drift, hosts outside the snapshot, and exhausted budgets", async () => {
    await expect(new ToolPolicyEngine().evaluate(request({ expectedSchemaDigest: "0".repeat(64) }))).resolves.toMatchObject({ decision: "DENY", reason: "tool_schema_digest_mismatch" });
    await expect(new ToolPolicyEngine().evaluate(request({ targetHost: "evil.example" }))).resolves.toMatchObject({ decision: "DENY", reason: "host_not_allowed" });
    await expect(new ToolPolicyEngine().evaluate(request({ remainingToolCalls: 0 }))).resolves.toMatchObject({ decision: "DENY", reason: "tool_budget_exhausted" });
  });

  it("requires digest-bound approval for destructive or configured tools", async () => {
    const pending = await new ToolPolicyEngine().evaluate(request({ policy: { ...policy, approvalTools: ["room.write"] } }));
    expect(pending).toMatchObject({ decision: "REQUIRE_APPROVAL", reason: "tool_approval_required" });
    const approved = await new ToolPolicyEngine().evaluate(request({
      policy: { ...policy, approvalTools: ["room.write"] },
      approvedArgumentsDigest: argumentsDigest({ value: "safe" }),
    }));
    expect(approved.decision).toBe("ALLOW");
    const changed = await new ToolPolicyEngine().evaluate(request({
      arguments: { value: "changed" },
      policy: { ...policy, approvalTools: ["room.write"] },
      approvedArgumentsDigest: argumentsDigest({ value: "safe" }),
    }));
    expect(changed.decision).toBe("REQUIRE_APPROVAL");
  });
});
