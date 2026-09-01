import { z } from "zod";
import { runResultSchema } from "./result";

const eventBase = { sequence: z.number().int().nonnegative() };

export const runEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...eventBase, type: z.literal("run.started") }),
  z.strictObject({ ...eventBase, type: z.literal("assistant.delta"), text: z.string() }),
  z.strictObject({ ...eventBase, type: z.literal("thinking.summary"), text: z.string() }),
  z.strictObject({ ...eventBase, type: z.literal("tool.started"), callId: z.string(), toolId: z.string() }),
  z.strictObject({ ...eventBase, type: z.literal("tool.completed"), callId: z.string(), ok: z.boolean() }),
  z.strictObject({ ...eventBase, type: z.literal("approval.required"), approvalId: z.string() }),
  z.strictObject({ ...eventBase, type: z.literal("run.blocked"), reason: z.string() }),
  z.strictObject({ ...eventBase, type: z.literal("run.completed"), result: runResultSchema }),
  z.strictObject({ ...eventBase, type: z.literal("run.failed"), code: z.string(), retryable: z.boolean() }),
]);

export type RunEvent = z.infer<typeof runEventSchema>;
