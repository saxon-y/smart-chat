import { createHmac, timingSafeEqual } from "node:crypto";

import type { TaskCredentialClaims } from "./types";

const VERSION = "v1";

function encode(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function signature(secret: string, payload: string) {
  return encode(createHmac("sha256", secret).update(`${VERSION}.${payload}`).digest());
}

export class TaskCredentialError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "TaskCredentialError";
  }
}

export function issueTaskCredential(
  claims: Omit<TaskCredentialClaims, "issuedAt" | "expiresAt">,
  secret: string,
  options: { now?: number; ttlMs?: number } = {},
) {
  if (Buffer.byteLength(secret) < 32) throw new TaskCredentialError("credential_secret_too_short");
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? 60_000;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 5 * 60_000) throw new TaskCredentialError("credential_ttl_invalid");
  const payload = encode(JSON.stringify({ ...claims, capabilities: [...new Set(claims.capabilities)].sort(), issuedAt: now, expiresAt: now + ttlMs }));
  return `${VERSION}.${payload}.${signature(secret, payload)}`;
}

export function verifyTaskCredential(
  token: string,
  secret: string,
  expected: { runId: string; daemonId: string; capabilities: readonly string[] },
  now = Date.now(),
): TaskCredentialClaims {
  const [version, payload, suppliedSignature, extra] = token.split(".");
  if (version !== VERSION || !payload || !suppliedSignature || extra) throw new TaskCredentialError("credential_malformed");
  const expectedSignature = signature(secret, payload);
  const left = Buffer.from(suppliedSignature);
  const right = Buffer.from(expectedSignature);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new TaskCredentialError("credential_signature_invalid");
  let claims: TaskCredentialClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TaskCredentialClaims;
  } catch {
    throw new TaskCredentialError("credential_malformed");
  }
  if (!claims || typeof claims.runId !== "string" || typeof claims.daemonId !== "string" || !Array.isArray(claims.capabilities)
    || claims.capabilities.some((value) => typeof value !== "string") || !Number.isSafeInteger(claims.issuedAt) || !Number.isSafeInteger(claims.expiresAt)) {
    throw new TaskCredentialError("credential_malformed");
  }
  if (claims.expiresAt <= now || claims.issuedAt > now) throw new TaskCredentialError("credential_expired");
  if (claims.runId !== expected.runId || claims.daemonId !== expected.daemonId) throw new TaskCredentialError("credential_subject_mismatch");
  const granted = new Set(claims.capabilities);
  if (expected.capabilities.some((capability) => !granted.has(capability))) throw new TaskCredentialError("credential_capability_mismatch");
  return claims;
}
