import { z } from "zod";

export const aiConfigSchema = z.object({
  model: z.string().trim().min(1).max(200),
  baseUrl: z.string().url().max(1000),
  apiKey: z.string().max(1000).optional(),
  secretRef: z.string().trim().min(1).max(200).optional(),
  timeoutMs: z.number().int().min(1000).max(120000).default(30000),
  enabled: z.boolean().default(true),
});

export const healthCheckSchema = z.object({ id: z.string().optional() });
