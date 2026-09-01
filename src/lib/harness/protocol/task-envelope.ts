import { z } from "zod";
import { contextBundleSchema } from "./context";
import { mcpBundleSchema } from "./mcp";
import { executionLimitsSchema, executionPolicySchema } from "./policy";
import { skillBundleSchema } from "./skill";

const snapshotSchema = z.record(z.string(), z.unknown());
const forbiddenKey = /^(?:api[-_]?key|authorization|cookie|password|secret|token|ciphertext)$/i;

function findForbiddenKey(value: unknown, path = "task"): string | undefined {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenKey(value[index], `${path}[${index}]`);
      if (found) return found;
    }
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (forbiddenKey.test(key)) return `${path}.${key}`;
      const found = findForbiddenKey(item, `${path}.${key}`);
      if (found) return found;
    }
  }
  return undefined;
}

export const taskEnvelopeSchema = z.strictObject({
  protocolVersion: z.literal("smart-chat-harness/v1"),
  runId: z.string().min(1),
  parentRunId: z.string().min(1).optional(),
  roomId: z.string().min(1),
  triggerMessageId: z.string().min(1),
  objective: z.string().min(1),
  agent: snapshotSchema,
  runtime: z.strictObject({
    id: z.string().min(1),
    kind: z.enum(["EMBEDDED", "SELF_HOSTED", "DAEMON"]),
    adapter: z.string().min(1),
    adapterVersion: z.string().min(1),
    requiredCapabilities: z.array(z.string()),
  }),
  contextBundle: contextBundleSchema,
  skillBundle: skillBundleSchema,
  mcpBundle: mcpBundleSchema,
  policy: executionPolicySchema,
  limits: executionLimitsSchema,
  outputContract: z.strictObject({
    format: z.enum(["TEXT", "JSON", "ARTIFACT_SET"]),
    schema: z.record(z.string(), z.unknown()).optional(),
  }),
}).superRefine((value, context) => {
  const path = findForbiddenKey(value);
  if (path) context.addIssue({ code: "custom", message: `task_envelope_forbidden_secret_field:${path}` });
});

export type TaskEnvelope = z.infer<typeof taskEnvelopeSchema>;
