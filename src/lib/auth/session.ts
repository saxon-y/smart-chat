import argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { db } from "@/lib/db";

export const SESSION_COOKIE = "smart_chat_session";
const SESSION_DAYS = 30;

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return new TextEncoder().encode(value);
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function hashPassword(password: string) {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string) {
  return argon2.verify(hash, password);
}

export async function createSession(userId: string) {
  const sid = randomBytes(18).toString("hex");
  const jti = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.session.create({ data: { id: sid, userId, tokenHash: hashToken(jti), expiresAt } });
  const token = await new SignJWT({ sid, sub: userId, jti })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secret());
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // Only require Secure when explicitly behind HTTPS. Tying this to
    // NODE_ENV breaks login over plain HTTP on LAN IPs: browsers accept
    // Secure cookies on http://localhost (a secure context) but drop them
    // on http://10.x.x.x, so localhost works and the LAN IP does not.
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return { token, expiresAt };
}

export async function revokeCurrentSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, secret());
      if (typeof payload.sid === "string") {
        await db.session.updateMany({ where: { id: payload.sid, revokedAt: null }, data: { revokedAt: new Date() } });
      }
    } catch { /* invalid/expired cookies are simply cleared */ }
  }
  store.delete(SESSION_COOKIE);
}

export async function getCurrentUser() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const sid = typeof payload.sid === "string" ? payload.sid : null;
    const jti = typeof payload.jti === "string" ? payload.jti : null;
    if (!sid || !jti) return null;
    const session = await db.session.findUnique({ where: { id: sid }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.tokenHash !== hashToken(jti)) return null;
    if (session.user.status !== "ACTIVE") return null;
    return session.user;
  } catch {
    return null;
  }
}

