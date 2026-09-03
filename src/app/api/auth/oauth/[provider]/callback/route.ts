import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import * as oidc from "openid-client";
import { createSession } from "@/lib/auth/session";
import { authenticateOAuthProfile, OAUTH_COOKIE, OAuthError, oauthConfiguration, oauthOrigin, oauthProfile, oauthRedirectUri, parseOAuthProvider, readOAuthState } from "@/lib/auth/oauth";

export const runtime = "nodejs";

function clearOAuthCookie(response: NextResponse) {
  response.cookies.set(OAUTH_COOKIE, "", {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "lax",
    path: "/api/auth/oauth",
    maxAge: 0,
  });
  return response;
}

function loginRedirect(request: Request, code: string) {
  const response = NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(code)}`, request.url));
  return clearOAuthCookie(response);
}

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const provider = parseOAuthProvider((await context.params).provider);
  if (!provider) return loginRedirect(request, "oauth_provider_invalid");
  const requestUrl = new URL(request.url);
  if (requestUrl.searchParams.has("error")) return loginRedirect(request, "oauth_cancelled");
  const encodedCookie = (await cookies()).get(OAUTH_COOKIE)?.value;
  if (!encodedCookie) return loginRedirect(request, "oauth_state_missing");

  try {
    const state = await readOAuthState(encodedCookie);
    if (state.provider !== provider) throw new OAuthError("oauth_state_invalid", "登录方式不匹配");
    const { configuration } = oauthConfiguration(provider);
    const tokens = await oidc.authorizationCodeGrant(await configuration, request, {
      pkceCodeVerifier: state.codeVerifier,
      expectedState: state.state,
      expectedNonce: state.nonce,
      idTokenExpected: true,
    }, { redirect_uri: oauthRedirectUri(request, provider) });
    const claims = tokens.claims();
    if (!claims) throw new OAuthError("oauth_token_invalid", "第三方登录未返回身份信息");
    const user = await authenticateOAuthProfile(oauthProfile(provider, claims as Record<string, unknown>));
    await createSession(user.id);
    const response = NextResponse.redirect(new URL(state.returnTo, oauthOrigin(request)));
    return clearOAuthCookie(response);
  } catch (error) {
    console.error(`[oauth] failed to complete ${provider} login`, error);
    return loginRedirect(request, error instanceof OAuthError ? error.code : "oauth_callback_failed");
  }
}
