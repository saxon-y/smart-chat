import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@prisma/client";
import { OAuthError, oauthProfile, parseOAuthProvider, safeReturnTo } from "./oauth";

describe("oauth helpers", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-secret");
    vi.stubEnv("MICROSOFT_CLIENT_ID", "microsoft-client");
    vi.stubEnv("MICROSOFT_CLIENT_SECRET", "microsoft-secret");
    vi.stubEnv("MICROSOFT_TENANT", "consumers");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("accepts only configured provider keys", () => {
    expect(parseOAuthProvider("google")).toBe("google");
    expect(parseOAuthProvider("microsoft")).toBe("microsoft");
    expect(parseOAuthProvider("github")).toBeNull();
  });

  it("allows only local return paths", () => {
    expect(safeReturnTo("/chat?room=1")).toBe("/chat?room=1");
    expect(safeReturnTo("//evil.example")).toBe("/chat");
    expect(safeReturnTo("https://evil.example")).toBe("/chat");
  });

  it("maps a verified Google identity", () => {
    expect(oauthProfile("google", {
      sub: "google-user",
      email: "USER@EXAMPLE.COM",
      email_verified: true,
      name: "Google User",
    })).toEqual({
      provider: AuthProvider.GOOGLE,
      subject: "google-user",
      email: "user@example.com",
      displayName: "Google User",
    });
  });

  it("rejects an unverified Google email", () => {
    expect(() => oauthProfile("google", { sub: "google-user", email: "user@example.com", email_verified: false }))
      .toThrowError(OAuthError);
  });

  it("uses Microsoft preferred_username when email is absent", () => {
    expect(oauthProfile("microsoft", {
      sub: "microsoft-user",
      preferred_username: "person@outlook.com",
      name: "Microsoft User",
    })).toMatchObject({
      provider: AuthProvider.MICROSOFT,
      subject: "microsoft-user",
      email: "person@outlook.com",
    });
  });
});
