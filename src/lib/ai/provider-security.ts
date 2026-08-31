import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function configuredHosts() {
  return new Set((process.env.AI_PROVIDER_HOST_ALLOWLIST ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean));
}

function privateAddress(address: string) {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || parts[0] === 0
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

export function providerUrlAllowedByPolicy(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (!url.hostname || url.username || url.password) return false;
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:")) return false;
  const allowlist = configuredHosts();
  if (allowlist.size > 0 && !allowlist.has(url.hostname.toLowerCase())) return false;
  if (process.env.NODE_ENV === "production" && allowlist.size === 0) return false;
  return true;
}

export async function assertSafeProviderUrl(value: string, sourceHost?: string) {
  if (!providerUrlAllowedByPolicy(value)) throw new Error("provider_url_not_allowed");
  const url = new URL(value);
  const allowlist = configuredHosts();
  if (sourceHost && url.hostname !== sourceHost && !allowlist.has(url.hostname.toLowerCase())) throw new Error("provider_image_host_not_allowed");
  if (isIP(url.hostname)) {
    if (privateAddress(url.hostname) && process.env.NODE_ENV === "production") throw new Error("provider_private_address");
    return url;
  }
  const addresses = await lookup(url.hostname, { all: true });
  if (process.env.NODE_ENV === "production" && addresses.some(({ address }) => privateAddress(address))) throw new Error("provider_private_address");
  return url;
}
