"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(
          mode === "register"
            ? { email, password, displayName }
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
          <span className="brand-name">Smart Chat</span>
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
              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                required
              />
            </div>
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
                  ? "进入 Smart Chat"
                  : "创建账号"}
            </button>
          </form>
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
