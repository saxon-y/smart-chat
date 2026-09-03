import { z } from "zod";
import { errorResponse, json } from "@/lib/http";
import { EmailVerificationError, issueRegistrationCode } from "@/lib/auth/email-verification";

export const runtime = "nodejs";

const requestSchema = z.object({
  email: z.string().trim().email().max(320),
  purpose: z.literal("REGISTER").default("REGISTER"),
});

function requestIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || null;
}

export async function POST(request: Request) {
  try {
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return errorResponse("邮箱格式不合法", 400, "VALIDATION_ERROR");
    const result = await issueRegistrationCode(parsed.data.email, requestIp(request));
    return json({
      ok: true,
      sent: process.env.NODE_ENV === "production" ? undefined : result.sent,
      retryAfterSeconds: result.retryAfterSeconds,
      message: "如果该邮箱可以注册，验证码将发送到邮箱。",
    });
  } catch (error) {
    if (error instanceof EmailVerificationError) return errorResponse(error.message, error.status, error.code);
    return errorResponse("验证码暂时无法发送，请稍后再试", 502, "EMAIL_SEND_FAILED");
  }
}
