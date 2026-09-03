import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { EmailVerificationPurpose, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { sendVerificationEmail } from "@/lib/email/sender";
import { normalizeEmail } from "./session";

const CODE_TTL_MINUTES = 10;
const RESEND_COOLDOWN_MS = 60_000;
const EMAIL_HOURLY_LIMIT = 5;
const IP_HOURLY_LIMIT = 20;
const MAX_ATTEMPTS = 5;

export class EmailVerificationError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
  }
}

function verificationSecret() {
  const value = process.env.EMAIL_CODE_SECRET;
  if (!value || value.length < 32) throw new Error("EMAIL_CODE_SECRET must be at least 32 characters");
  return value;
}

function codeDigest(email: string, purpose: EmailVerificationPurpose, code: string) {
  return createHmac("sha256", verificationSecret()).update(`${purpose}:${email}:${code}`).digest("hex");
}

export function requestIpHash(requestIp?: string | null) {
  const normalized = requestIp?.trim();
  if (!normalized) return null;
  return createHmac("sha256", verificationSecret()).update(`ip:${normalized}`).digest("hex");
}

function equalDigest(left: string, right: string) {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export async function issueRegistrationCode(rawEmail: string, rawRequestIp?: string | null) {
  const email = normalizeEmail(rawEmail);
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const ipHash = requestIpHash(rawRequestIp);
  const [lastCode, emailCount, ipCount, existingUser] = await Promise.all([
    db.emailVerificationCode.findFirst({
      where: { email, purpose: EmailVerificationPurpose.REGISTER },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    db.emailVerificationCode.count({ where: { email, purpose: EmailVerificationPurpose.REGISTER, createdAt: { gte: hourAgo } } }),
    ipHash ? db.emailVerificationCode.count({ where: { requestIpHash: ipHash, createdAt: { gte: hourAgo } } }) : Promise.resolve(0),
    db.user.findUnique({ where: { email }, select: { id: true } }),
  ]);

  if (lastCode && now.getTime() - lastCode.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    const retryAfterSeconds = Math.ceil((RESEND_COOLDOWN_MS - (now.getTime() - lastCode.createdAt.getTime())) / 1000);
    throw new EmailVerificationError("CODE_COOLDOWN", 429, `请等待 ${retryAfterSeconds} 秒后再发送`);
  }
  if (emailCount >= EMAIL_HOURLY_LIMIT || ipCount >= IP_HOURLY_LIMIT) {
    throw new EmailVerificationError("CODE_RATE_LIMITED", 429, "验证码发送过于频繁，请稍后再试");
  }
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const expiresAt = new Date(now.getTime() + CODE_TTL_MINUTES * 60 * 1000);
  const record = await db.$transaction(async (tx) => {
    await tx.emailVerificationCode.updateMany({
      where: { email, purpose: EmailVerificationPurpose.REGISTER, consumedAt: null },
      data: { consumedAt: now },
    });
    return tx.emailVerificationCode.create({
      data: {
        email,
        purpose: EmailVerificationPurpose.REGISTER,
        codeHash: codeDigest(email, EmailVerificationPurpose.REGISTER, code),
        expiresAt,
        requestIpHash: ipHash,
      },
      select: { id: true },
    });
  });

  if (existingUser) return { sent: false, retryAfterSeconds: 60 };

  try {
    await sendVerificationEmail({ to: email, code, expiresInMinutes: CODE_TTL_MINUTES });
  } catch (error) {
    await db.emailVerificationCode.updateMany({ where: { id: record.id, consumedAt: null }, data: { consumedAt: new Date() } });
    throw error;
  }
  return { sent: true, retryAfterSeconds: 60 };
}

export async function consumeRegistrationCode(tx: Prisma.TransactionClient, rawEmail: string, code: string) {
  const email = normalizeEmail(rawEmail);
  const now = new Date();
  const record = await tx.emailVerificationCode.findFirst({
    where: { email, purpose: EmailVerificationPurpose.REGISTER, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!record || record.expiresAt <= now || record.attempts >= MAX_ATTEMPTS) {
    if (record && !record.consumedAt) await tx.emailVerificationCode.update({ where: { id: record.id }, data: { consumedAt: now } });
    throw new EmailVerificationError("CODE_INVALID", 400, "验证码无效或已过期");
  }

  const valid = equalDigest(record.codeHash, codeDigest(email, EmailVerificationPurpose.REGISTER, code));
  if (!valid) {
    const nextAttempts = record.attempts + 1;
    await tx.emailVerificationCode.update({
      where: { id: record.id },
      data: { attempts: nextAttempts, ...(nextAttempts >= MAX_ATTEMPTS ? { consumedAt: now } : {}) },
    });
    throw new EmailVerificationError("CODE_INVALID", 400, "验证码无效或已过期");
  }

  const consumed = await tx.emailVerificationCode.updateMany({
    where: { id: record.id, consumedAt: null },
    data: { consumedAt: now },
  });
  if (consumed.count !== 1) throw new EmailVerificationError("CODE_INVALID", 400, "验证码无效或已过期");
}
