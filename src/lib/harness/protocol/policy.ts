import { z } from "zod";

export const executionPolicySchema = z.strictObject({
  version: z.number().int().positive(),
  allowedTools: z.array(z.string()),
  deniedTools: z.array(z.string()),
  approvalTools: z.array(z.string()),
  allowedHosts: z.array(z.string()),
  workspaceRoots: z.array(z.string()),
  maxCostMicros: z.number().int().nonnegative().optional(),
  toolDisclosure: z.enum(["index", "full"]).default("index"),
  skillDisclosure: z.enum(["catalog", "full"]).default("catalog"),
});

export const executionLimitsSchema = z.strictObject({
  maxTurns: z.number().int().positive(),
  maxInputTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  maxToolCalls: z.number().int().nonnegative(),
  maxWallTimeMs: z.number().int().positive(),
  maxCostMicros: z.number().int().nonnegative().optional(),
});

export type ExecutionPolicy = z.infer<typeof executionPolicySchema>;
export type ExecutionLimits = z.infer<typeof executionLimitsSchema>;
