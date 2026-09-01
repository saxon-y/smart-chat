import { z } from "zod";
import { artifactRefSchema } from "./context";

export const contentPartSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("text"), text: z.string() }),
  z.strictObject({ type: z.literal("json"), value: z.unknown() }),
  z.strictObject({ type: z.literal("artifact"), artifactId: z.string(), mimeType: z.string() }),
]);

export const usageSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  costMicros: z.number().int().nonnegative().optional(),
});

export const runResultSchema = z.strictObject({
  status: z.enum(["COMPLETED", "BLOCKED", "FAILED", "CANCELLED"]),
  output: z.array(contentPartSchema),
  summary: z.string(),
  artifacts: z.array(artifactRefSchema),
  decisions: z.array(z.record(z.string(), z.unknown())),
  followups: z.array(z.string()),
  usage: usageSchema,
  continuity: z.enum(["FULL", "REBUILT", "GAP"]),
});

export type ContentPart = z.infer<typeof contentPartSchema>;
export type Usage = z.infer<typeof usageSchema>;
export type RunResult = z.infer<typeof runResultSchema>;
