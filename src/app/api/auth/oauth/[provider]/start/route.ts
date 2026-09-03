import { NextResponse } from "next/server";
import { createOAuthRequest, OAUTH_COOKIE, OAUTH_COOKIE_MAX_AGE, OAuthError, parseOAuthProvider } from "@/lib/auth/oauth";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const provider = parseOAuthProvider((await context.params).provider);
  if (!provider) return NextResponse.json({ error: { code: "OAUTH_PROVIDER_INVALID", message: "不支持的登录方式" } }, { status: 404 });
  try {
    const { authorizationUrl, cookie } = await createOAuthRequest(request, provider);
    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set(OAUTH_COOKIE, cookie, {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === "true",
      sameSite: "lax",
      path: "/api/auth/oauth",
      maxAge: OAUTH_COOKIE_MAX_AGE,
    });
    return response;
  } catch (error) {
    console.error(`[oauth] failed to start ${provider} login`, error);
    const code = error instanceof OAuthError ? error.code : "oauth_start_failed";
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(code)}`, request.url));
  }
}
