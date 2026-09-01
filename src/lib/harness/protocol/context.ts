import { z } from "zod";

export const contentOriginSchema = z.enum([
  "system_policy", "user", "skill", "tool", "mcp", "memory", "retrieval", "child_handoff",
]);

export const contextBlockSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(["policy", "agent", "task", "skill", "message", "memory", "artifact", "tool-result", "handoff"]),
  origin: contentOriginSchema,
  priority: z.number().int(),
  tokenEstimate: z.number().int().nonnegative(),
  content: z.string(),
  pinned: z.boolean().optional(),
  expiresAfterTurn: z.number().int().positive().optional(),
  sourceRef: z.string().optional(),
});

export const artifactRefSchema = z.strictObject({
  id: z.string().min(1),
  mimeType: z.string().min(1),
  sha256: z.string().optional(),
  byteSize: z.number().int().nonnegative().optional(),
});

export const contextBundleSchema = z.strictObject({
  generation: z.number().int().nonnegative(),
  objective: z.string().min(1),
  blocks: z.array(contextBlockSchema),
  referencedArtifacts: z.array(artifactRefSchema),
  decisions: z.array(z.record(z.string(), z.unknown())),
  unresolved: z.array(z.string()),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});

export type ContextBlock = z.infer<typeof contextBlockSchema>;
export type ContextBundle = z.infer<typeof contextBundleSchema>;
export type ArtifactRef = z.infer<typeof artifactRefSchema>;
