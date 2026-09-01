import { createHash } from "node:crypto";

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("canonical_json_non_finite_number");
  if (typeof value === "bigint") throw new Error("canonical_json_bigint_unsupported");
  return value;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(normalize(value));
}

export function sha256Digest(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
