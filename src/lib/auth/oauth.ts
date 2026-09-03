import { createHash } from "node:crypto";
import { AuthProvider, Prisma } from "@prisma/client";
import { EncryptJWT, jwtDecrypt } from "jose";
import * as oidc from "openid-client";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { db } from "@/lib/db";
import { normalizeEmail } from "./session";

export type OAuthProviderKey = "google" | "microsoft";

type OAuthState = {
  provider: OAuthProviderKey;
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
};

export type OAuthProfile = {
  provider: AuthProvider;
  subject: string;
  email: string;
  displayName: string;
};

export const OAUTH_COOKIE = "smart_chat_oauth";
export const OAUTH_COOKIE_MAX_AGE = 10 * 60;

export class OAuthError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new OAuthError("oauth_not_configured", `${name} 尚未配置`);
  return value;
}

function stateKey() {
  const value = process.env.OAUTH_STATE_SECRET;
  if (!value || value.length < 32) throw new OAuthError("oauth_not_configured", "OAUTH_STATE_SECRET 尚未配置");
  return createHash("sha256").update(value).digest();
}

export function parseOAuthProvider(value: string): OAuthProviderKey | null {
  return value === "google" || value === "microsoft" ? value : null;
}

export function oauthProviderAvailability() {
  return {
    google: Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim()),
    microsoft: Boolean(process.env.MICROSOFT_CLIENT_ID?.trim() && process.env.MICROSOFT_CLIENT_SECRET?.trim()),
  };
}

function providerSettings(provider: OAuthProviderKey) {
  if (provider === "google") {
    return {
      provider: AuthProvider.GOOGLE,
      issuer: new URL("https://accounts.google.com"),
      clientId: required("GOOGLE_CLIENT_ID"),
      clientSecret: required("GOOGLE_CLIENT_SECRET"),
      scope: "openid email profile",
      prompt: "select_account",
    };
  }
  const tenant = process.env.MICROSOFT_TENANT?.trim() || "consumers";
  if (!/^[A-Za-z0-9.-]+$/.test(tenant)) throw new OAuthError("oauth_not_configured", "MICROSOFT_TENANT 配置不合法");
  return {
    provider: AuthProvider.MICROSOFT,
    issuer: new URL(`https://login.microsoftonline.com/${tenant}/v2.0`),
    clientId: required("MICROSOFT_CLIENT_ID"),
    clientSecret: required("MICROSOFT_CLIENT_SECRET"),
    scope: "openid email profile",
    prompt: "select_account",
  };
}

const discoveryCache = new Map<string, Promise<oidc.Configuration>>();
let proxyCache: { url: string; agent: ProxyAgent } | null = null;

function oauthCustomFetch() {
  const proxy = process.env.OAUTH_HTTP_PROXY?.trim();
  if (!proxy) return undefined;
  const proxyUrl = new URL(proxy);
  if (!["http:", "https:"].includes(proxyUrl.protocol) || proxyUrl.username || proxyUrl.password) {
    throw new OAuthError("oauth_not_configured", "OAUTH_HTTP_PROXY 配置不合法");
  }
  if (!proxyCache || proxyCache.url !== proxyUrl.href) {
    proxyCache?.agent.close().catch(() => undefined);
    proxyCache = { url: proxyUrl.href, agent: new ProxyAgent(proxyUrl.href) };
  }
  const dispatcher = proxyCache.agent;
  const proxiedFetch: oidc.CustomFetch = (url, options) => {
    const requestOptions = { ...options, dispatcher } as unknown as Parameters<typeof undiciFetch>[1];
    return undiciFetch(url, requestOptions) as unknown as Promise<Response>;
  };
  return proxiedFetch;
}

export function oauthConfiguration(provider: OAuthProviderKey) {
  const settings = providerSettings(provider);
  const key = `${settings.issuer.href}:${settings.clientId}`;
  let pending = discoveryCache.get(key);
  if (!pending) {
    const customFetch = oauthCustomFetch();
    const options: oidc.DiscoveryRequestOptions = {};
    if (customFetch) options[oidc.customFetch] = customFetch;
    pending = oidc.discovery(settings.issuer, settings.clientId, settings.clientSecret, undefined, options).catch((error) => {
      discoveryCache.delete(key);
      throw error;
    });
    discoveryCache.set(key, pending);
  }
  return { settings, configuration: pending };
}

export function oauthOrigin(request: Request) {
  const configured = process.env.APP_ORIGIN?.trim();
  if (configured) {
    const url = new URL(configured);
    if (url.username || url.password || !["http:", "https:"].includes(url.protocol)) throw new OAuthError("oauth_not_configured", "APP_ORIGIN 配置不合法");
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new OAuthError("oauth_not_configured", "生产环境 APP_ORIGIN 必须使用 HTTPS");
    return url.origin;
  }
  if (process.env.NODE_ENV === "production") throw new OAuthError("oauth_not_configured", "生产环境必须配置 APP_ORIGIN");
  return new URL(request.url).origin;
}

export function oauthRedirectUri(request: Request, provider: OAuthProviderKey) {
  return `${oauthOrigin(request)}/api/auth/oauth/${provider}/callback`;
}

export function safeReturnTo(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/chat";
}

export async function createOAuthRequest(request: Request, provider: OAuthProviderKey) {
  const { settings, configuration } = oauthConfiguration(provider);
  const config = await configuration;
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"));
  const authorizationUrl = oidc.buildAuthorizationUrl(config, {
    redirect_uri: oauthRedirectUri(request, provider),
    scope: settings.scope,
    response_type: "code",
    code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: "S256",
    state,
    nonce,
    prompt: settings.prompt,
  });
  const cookie = await new EncryptJWT({ provider, state, nonce, codeVerifier, returnTo })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${OAUTH_COOKIE_MAX_AGE}s`)
    .encrypt(stateKey());
  return { authorizationUrl, cookie };
}

export async function readOAuthState(cookie: string): Promise<OAuthState> {
  try {
    const { payload } = await jwtDecrypt(cookie, stateKey());
    const provider = typeof payload.provider === "string" ? parseOAuthProvider(payload.provider) : null;
    if (!provider || typeof payload.state !== "string" || typeof payload.nonce !== "string" || typeof payload.codeVerifier !== "string" || typeof payload.returnTo !== "string") {
      throw new Error("invalid state");
    }
    return { provider, state: payload.state, nonce: payload.nonce, codeVerifier: payload.codeVerifier, returnTo: safeReturnTo(payload.returnTo) };
  } catch {
    throw new OAuthError("oauth_state_invalid", "登录状态已失效，请重新尝试");
  }
}

function claimString(claims: Record<string, unknown>, name: string) {
  const value = claims[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function oauthProfile(provider: OAuthProviderKey, claims: Record<string, unknown>): OAuthProfile {
  const settings = providerSettings(provider);
  const subject = claimString(claims, "sub");
  const rawEmail = provider === "microsoft"
    ? claimString(claims, "email") || claimString(claims, "preferred_username")
    : claimString(claims, "email");
  if (!subject || !rawEmail) throw new OAuthError("oauth_email_missing", "第三方账号没有返回可用邮箱");
  if (provider === "google" && claims.email_verified !== true) throw new OAuthError("oauth_email_unverified", "Google 邮箱尚未验证");
  const email = normalizeEmail(rawEmail);
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 320) throw new OAuthError("oauth_email_invalid", "第三方账号返回的邮箱不合法");
  const displayName = (claimString(claims, "name") || email.split("@")[0]).slice(0, 80);
  return { provider: settings.provider, subject, email, displayName };
}

export async function authenticateOAuthProfile(profile: OAuthProfile) {
  try {
    return await db.$transaction(async (tx) => {
      const identity = await tx.authIdentity.findUnique({
        where: { provider_providerSubject: { provider: profile.provider, providerSubject: profile.subject } },
        include: { user: true },
      });
      if (identity) {
        if (identity.user.status !== "ACTIVE") throw new OAuthError("account_disabled", "账号已停用");
        if (identity.providerEmail !== profile.email) {
          await tx.authIdentity.update({ where: { id: identity.id }, data: { providerEmail: profile.email } });
        }
        return identity.user;
      }

      const emailOwner = await tx.user.findUnique({ where: { email: profile.email }, select: { id: true } });
      if (emailOwner) throw new OAuthError("oauth_account_conflict", "该邮箱已有账号，请先使用原方式登录");

      return tx.user.create({
        data: {
          email: profile.email,
          emailVerifiedAt: new Date(),
          displayName: profile.displayName,
          authIdentities: {
            create: { provider: profile.provider, providerSubject: profile.subject, providerEmail: profile.email },
          },
        },
      });
    });
  } catch (error) {
    if (error instanceof OAuthError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new OAuthError("oauth_account_conflict", "该第三方账号或邮箱已被使用");
    }
    throw error;
  }
}
