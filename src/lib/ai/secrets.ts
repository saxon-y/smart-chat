import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc:v1";

function encryptionKey() {
  const source = process.env.AI_CONFIG_ENCRYPTION_KEY ?? process.env.SESSION_SECRET;
  if (!source || source.length < 32) {
    throw new Error("AI_CONFIG_ENCRYPTION_KEY must be at least 32 characters");
  }
  return createHash("sha256").update(source).digest();
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [PREFIX, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptSecret(value: string | null | undefined) {
  if (!value) return undefined;
  const [enc, version, ivValue, tagValue, ciphertextValue] = value.split(":");
  if (`${enc}:${version}` !== PREFIX || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error("AI provider secret is not encrypted");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
