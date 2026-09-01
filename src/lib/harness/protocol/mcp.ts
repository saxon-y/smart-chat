import { z } from "zod";

export const approvedMcpToolSchema = z.strictObject({
  serverId: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
  schemaDigest: z.string().regex(/^[a-f0-9]{64}$/),
  risk: z.enum(["READ", "WRITE", "DESTRUCTIVE"]),
});

export const mcpBundleSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  tools: z.array(approvedMcpToolSchema),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});

export type McpBundle = z.infer<typeof mcpBundleSchema>;
