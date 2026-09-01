import { z } from "zod";

export const loadedSkillSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  source: z.enum(["builtin", "workspace", "plugin"]),
  instructions: z.string(),
  files: z.array(z.strictObject({ path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/) })),
  triggers: z.array(z.string()),
  capabilities: z.array(z.string()),
  requiredTools: z.array(z.string()),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
});

export const skillBundleSchema = z.strictObject({
  version: z.literal(1),
  skills: z.array(loadedSkillSchema),
  bundleHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export type SkillBundle = z.infer<typeof skillBundleSchema>;
