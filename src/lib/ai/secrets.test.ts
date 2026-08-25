import { afterEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./secrets";

const originalKey = process.env.AI_CONFIG_ENCRYPTION_KEY;

afterEach(() => {
  process.env.AI_CONFIG_ENCRYPTION_KEY = originalKey;
});

describe("AI provider secret encryption", () => {
  it("round-trips without retaining plaintext", () => {
    process.env.AI_CONFIG_ENCRYPTION_KEY = "test-key-with-at-least-thirty-two-characters";
    const encrypted = encryptSecret("provider-secret");
    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toContain("provider-secret");
    expect(decryptSecret(encrypted)).toBe("provider-secret");
  });

  it("rejects plaintext database values", () => {
    process.env.AI_CONFIG_ENCRYPTION_KEY = "test-key-with-at-least-thirty-two-characters";
    expect(() => decryptSecret("provider-secret")).toThrow("not encrypted");
  });
});
