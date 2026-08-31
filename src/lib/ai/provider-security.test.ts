import { afterEach, describe, expect, it } from "vitest";
import { providerUrlAllowedByPolicy } from "./provider-security";

const originalAllowlist = process.env.AI_PROVIDER_HOST_ALLOWLIST;

afterEach(() => {
  if (originalAllowlist === undefined) delete process.env.AI_PROVIDER_HOST_ALLOWLIST;
  else process.env.AI_PROVIDER_HOST_ALLOWLIST = originalAllowlist;
});

describe("provider URL policy", () => {
  it("rejects credentials and non-http protocols", () => {
    expect(providerUrlAllowedByPolicy("file:///etc/passwd")).toBe(false);
    expect(providerUrlAllowedByPolicy("https://user:secret@example.com/v1")).toBe(false);
  });

  it("enforces the configured hostname allowlist", () => {
    process.env.AI_PROVIDER_HOST_ALLOWLIST = "api.example.com";
    expect(providerUrlAllowedByPolicy("https://api.example.com/v1")).toBe(true);
    expect(providerUrlAllowedByPolicy("https://evil.example/v1")).toBe(false);
  });
});
