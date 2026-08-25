import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(8).max(128),
  displayName: z.string().trim().min(1).max(80),
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(128),
});

export const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  avatarKey: z.string().trim().max(512).nullable().optional(),
}).refine((data) => data.displayName !== undefined || data.avatarKey !== undefined, { message: "没有需要保存的更改" });

