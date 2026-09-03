import { afterEach, describe, expect, it, vi } from "vitest";
import { sendVerificationEmail } from "./sender";

describe("sendVerificationEmail", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("logs development verification codes with the console provider", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "console");
    vi.stubEnv("NODE_ENV", "test");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await sendVerificationEmail({ to: "user@example.com", code: "123456", expiresInMinutes: 10 });

    expect(info).toHaveBeenCalledWith(expect.stringContaining("123456"));
  });

  it("does not allow the console provider in production", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "console");
    vi.stubEnv("NODE_ENV", "production");

    await expect(sendVerificationEmail({ to: "user@example.com", code: "123456", expiresInMinutes: 10 }))
      .rejects.toThrow("console_email_provider_disabled_in_production");
  });
});
