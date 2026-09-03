import nodemailer from "nodemailer";

type VerificationEmail = {
  to: string;
  code: string;
  expiresInMinutes: number;
};

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing_email_config:${name}`);
  return value;
}

function fromAddress() {
  return process.env.EMAIL_FROM?.trim() || "Smart Chat <no-reply@localhost>";
}

function emailContent({ code, expiresInMinutes }: VerificationEmail) {
  return {
    subject: "Smart Chat 邮箱验证码",
    text: `你的 Smart Chat 验证码是 ${code}。验证码将在 ${expiresInMinutes} 分钟后失效。如果不是你本人操作，请忽略这封邮件。`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#202124"><h2>Smart Chat 邮箱验证</h2><p>你的验证码是：</p><p style="font-size:30px;font-weight:700;letter-spacing:6px">${code}</p><p>验证码将在 ${expiresInMinutes} 分钟后失效。</p><p style="color:#666">如果不是你本人操作，请忽略这封邮件。</p></div>`,
  };
}

async function sendWithSmtp(input: VerificationEmail) {
  const port = Number(process.env.SMTP_PORT ?? "465");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid_email_config:SMTP_PORT");
  const transporter = nodemailer.createTransport({
    host: requiredEnv("SMTP_HOST"),
    port,
    secure: process.env.SMTP_SECURE !== "false",
    auth: { user: requiredEnv("SMTP_USER"), pass: requiredEnv("SMTP_PASSWORD") },
  });
  await transporter.sendMail({ from: fromAddress(), to: input.to, ...emailContent(input) });
}

async function sendWithResend(input: VerificationEmail) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${requiredEnv("RESEND_API_KEY")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from: fromAddress(), to: [input.to], ...emailContent(input) }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`email_provider_http_${response.status}`);
}

export async function sendVerificationEmail(input: VerificationEmail) {
  const provider = (process.env.EMAIL_PROVIDER ?? "console").trim().toLowerCase();
  if (provider === "console") {
    if (process.env.NODE_ENV === "production") throw new Error("console_email_provider_disabled_in_production");
    console.info(`[DEV EMAIL] ${input.to} 的验证码是 ${input.code}，${input.expiresInMinutes} 分钟内有效。`);
    return;
  }
  if (provider === "smtp") return sendWithSmtp(input);
  if (provider === "resend") return sendWithResend(input);
  throw new Error("unsupported_email_provider");
}
