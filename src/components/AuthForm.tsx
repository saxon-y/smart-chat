"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";

type Providers = { google: boolean; microsoft: boolean };

const OAUTH_ERRORS: Record<string, string> = {
  oauth_not_configured: "该第三方登录方式尚未配置。",
  oauth_cancelled: "第三方登录已取消。",
  oauth_state_missing: "登录状态已失效，请重新尝试。",
  oauth_state_invalid: "登录状态无效，请重新尝试。",
  oauth_email_missing: "第三方账号没有返回可用邮箱。",
  oauth_email_unverified: "第三方邮箱尚未验证。",
  oauth_account_conflict: "该邮箱已有账号，请先使用原方式登录。",
  account_disabled: "账号已停用。",
  oauth_callback_failed: "第三方登录暂时失败，请稍后重试。",
  oauth_start_failed: "暂时无法开始第三方登录。",
};

export default function AuthForm({ mode, oauthError }: { mode: "login" | "register"; oauthError?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState(oauthError ? OAUTH_ERRORS[oauthError] ?? "第三方登录失败，请重新尝试。" : "");
  const [busy, setBusy] = useState(false);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeCountdown, setCodeCountdown] = useState(0);
  const [providers, setProviders] = useState<Providers>({ google: false, microsoft: false });
  const router = useRouter();

  useEffect(() => {
    api<{ providers: Providers }>("/api/auth/providers")
      .then((result) => setProviders(result.providers))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (codeCountdown <= 0) return;
    const timer = window.setInterval(() => setCodeCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [codeCountdown]);

  async function sendCode() {
    setError("");
    if (!email.trim()) {
      setError("请先填写邮箱。");
      return;
    }
    setCodeBusy(true);
    try {
      const result = await api<{ retryAfterSeconds?: number; message?: string }>("/api/auth/email-code/send", {
        method: "POST",
        body: JSON.stringify({ email, purpose: "REGISTER" }),
      });
      setCodeCountdown(result.retryAfterSeconds ?? 60);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "验证码发送失败。");
    } finally {
      setCodeBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(
          mode === "register"
            ? { email, code, password, displayName }
            : { email, password },
        ),
      });
      router.push("/chat");
    } catch (exception) {
      setError(
        exception instanceof Error
          ? exception.message
          : "请求未能完成。",
      );
      setBusy(false);
    }
  }
  return (
    <div className="auth-shell">
      <section className="auth-aside">
        <div className="brand">
          <span className="brand-mark">↗</span>
          <span className="brand-name">EchoTalking</span>
        </div>
        <div className="auth-quote">
          <h1>
            留下信号，
            <br />
            去掉噪音。
          </h1>
          <p>
            给愿意公开思考、一起做决定，也希望助手守住边界的团队，一个更安静的房间。
          </p>
        </div>
        <div className="auth-aside-footer">
          <span /> 自托管 · 房间隔离 · 以人为先
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-form-wrap">
          <span className="auth-kicker">
            {mode === "login" ? "欢迎回来" : "加入新房间"}
          </span>
          <h2>
            {mode === "login"
              ? "登录你的工作区"
              : "创建账号"}
          </h2>
          <p className="auth-subtitle">
            {mode === "login"
              ? "你的房间、决策和上下文都还在。"
              : "加入一个专注的团队对话空间。"}
          </p>
          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}
          <form onSubmit={submit}>
            {mode === "register" && (
              <div className="field">
                <label htmlFor="displayName">姓名</label>
                <input
                  id="displayName"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="我们该怎么称呼你？"
                  autoComplete="name"
                  required
                />
                <span className="field-help">
                  请使用队友能认出来的名字。
                </span>
              </div>
            )}
            <div className="field">
              <label htmlFor="email">邮箱</label>
              <div className={mode === "register" ? "auth-inline-field" : undefined}>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@company.com"
                  autoComplete="email"
                  required
                />
                {mode === "register" && (
                  <button type="button" className="auth-code-button" onClick={sendCode} disabled={codeBusy || codeCountdown > 0}>
                    {codeBusy ? "发送中…" : codeCountdown > 0 ? `${codeCountdown}s` : "发送验证码"}
                  </button>
                )}
              </div>
            </div>
            {mode === "register" && (
              <div className="field">
                <label htmlFor="code">验证码</label>
                <input
                  id="code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="6 位数字验证码"
                  autoComplete="one-time-code"
                  required
                />
                <span className="field-help">验证码 10 分钟内有效。</span>
              </div>
            )}
            <div className="field">
              <label htmlFor="password">密码</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="至少 8 个字符"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                minLength={8}
                required
              />
            </div>
            <button className="auth-submit" disabled={busy}>
              {busy ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <ArrowRight size={15} />
              )}
              {busy
                ? "处理中…"
                : mode === "login"
                  ? "进入 EchoTalking"
                  : "创建账号"}
            </button>
          </form>
          {(providers.google || providers.microsoft) && (
            <>
              <div className="auth-divider"><span>或</span></div>
              <div className="auth-oauth-list">
                {providers.google && (
                  <a className="auth-oauth-button" href="/api/auth/oauth/google/start">
                    <span className="auth-provider-mark google">G</span>
                    使用 Google 继续
                  </a>
                )}
                {providers.microsoft && (
                  <a className="auth-oauth-button" href="/api/auth/oauth/microsoft/start">
                    <span className="auth-provider-mark microsoft">⊞</span>
                    使用 Microsoft 继续
                  </a>
                )}
              </div>
            </>
          )}
          <p className="auth-switch">
            {mode === "login"
              ? "还没有账号？ "
              : "已经有账号？ "}
            <a href={mode === "login" ? "/register" : "/login"}>
              {mode === "login" ? "去注册" : "去登录"}
            </a>
          </p>
        </div>
      </section>
    </div>
  );
}
