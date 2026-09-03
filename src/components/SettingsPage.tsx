"use client";

import { ArrowLeft, Check, Dices, ImagePlus, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { api, initials, unwrap, User } from "./api";

export default function SettingsPage() {
  const pathname = usePathname();
  const tab = pathname?.endsWith("/preferences") ? "preferences" : "profile";
  const [user, setUser] = useState<User>({
    displayName: "你的资料",
    email: "",
  });
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [savedError, setSavedError] = useState("");
  const [focusMode, setFocusMode] = useState(true);
  const [enterToSend, setEnterToSend] = useState(true);
  const [themeColor, setThemeColor] = useState<string>(() => {
    try { return localStorage.getItem("smartchat_theme") ?? "#c7613d"; } catch { return "#c7613d"; }
  });
  const [hexInput, setHexInput] = useState<string>(themeColor);

  function applyTheme(color: string) {
    setThemeColor(color);
    setHexInput(color);
    localStorage.setItem("smartchat_theme", color);
    document.documentElement.style.setProperty("--theme", color);
  }

  function commitHex(value: string) {
    setHexInput(value);
    const v = value.trim();
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) {
      applyTheme(v.toLowerCase());
    }
  }

  const themePresets = ["#c7613d", "#2563eb", "#0d9488", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0f172a"];

  useEffect(() => {
    api<User | { user?: User }>("/api/me")
      .then((payload) => {
        const next = unwrap(payload) as User | undefined;
        if (next) {
          setUser(next);
          setName(next.displayName ?? "");
          setAvatar(next.avatarKey ?? "");
        }
      })
      .catch(() => undefined);
  }, []);

  async function save() {
    setSaved(false);
    setSavedError("");
    try {
      const response = await api<User | { user?: User }>("/api/me", {
        method: "PATCH",
        body: JSON.stringify({ displayName: name, avatarKey: avatar || null }),
      });
      const updated = unwrap(response) as User | undefined;
      setUser((current) => ({
        ...current,
        displayName: updated?.displayName ?? name,
        avatarKey: updated?.avatarKey ?? avatar,
      }));
      setSaved(true);
    } catch (error) {
      setSavedError(error instanceof Error ? error.message : "保存失败");
    }
  }

  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState("");

  function generateAvatar(nextColor = themeColor) {
    const color = nextColor;
    const seed = Math.floor(Math.random() * 360);
    const secondary = `hsl(${(seed + 42) % 360} 48% 32%)`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="20" fill="${color}"/><path fill="${secondary}" d="M0 68 25 43l14 14 16-20 41 42H0Z"/><circle cx="31" cy="32" r="10" fill="#fff" fill-opacity=".82"/><path fill="#fff" fill-opacity=".34" d="M0 0h96v18H0z"/></svg>`;
    setAvatar(`data:image/svg+xml,${encodeURIComponent(svg)}`);
    setSaved(false);
    setSavedError("");
  }

  async function uploadAvatar(file: File) {
    setAvatarError("");
    if (!file.type.startsWith("image/")) { setAvatarError("请选择图片文件"); return; }
    if (file.size > 2 * 1024 * 1024) { setAvatarError("图片过大（上限 2MB）"); return; }
    setAvatarUploading(true);
    try {
      const form = new FormData();
      form.append("avatar", file);
      const response = await fetch("/api/me/avatar", { method: "POST", body: form, credentials: "include" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error?.message ?? "头像上传失败");
      const key = payload?.user?.avatarKey ?? null;
      setAvatar(key ?? "");
      setUser((current) => ({ ...current, avatarKey: key }));
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "头像上传失败");
    } finally {
      setAvatarUploading(false);
    }
  }

  async function clearAvatar() {
    setAvatarError("");
    try {
      const response = await api<User | { user?: User }>("/api/me", {
        method: "PATCH",
        body: JSON.stringify({ avatarKey: null }),
      });
      const updated = unwrap(response) as User | undefined;
      setAvatar(updated?.avatarKey ?? "");
      setUser((current) => ({ ...current, avatarKey: updated?.avatarKey ?? null }));
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "移除头像失败");
    }
  }

  return (
    <div className="page-shell">
      <div className="settings-shell">
        <div className="settings-top">
          <a
            href="/chat"
            className="icon-button"
            aria-label="返回聊天"
            title="返回聊天"
          >
            <ArrowLeft size={16} />
          </a>
          <div>
            <h1>个人资料</h1>
            <p>管理你的资料与界面偏好。</p>
          </div>
        </div>
        <nav className="settings-nav">
          <a
            href="/settings/profile"
            className={tab === "profile" ? "active" : ""}
          >
            个人资料
          </a>
          <a
            href="/settings/preferences"
            className={tab === "preferences" ? "active" : ""}
          >
            偏好设置
          </a>
          <a href="/chat">返回聊天</a>
        </nav>
        <div className="settings-grid">
          {tab === "profile" && (
            <section className="settings-section">
              <h2>资料详情</h2>
              <p>你加入的房间里，其他人能看到你的名字和头像。</p>
              <div className="profile-preview">
                <button
                  type="button"
                  className="profile-avatar-button"
                  onClick={() => avatar && setAvatarPreview(avatar)}
                  aria-label={avatar ? "查看头像大图" : "头像"}
                >
                  <span
                    className="avatar"
                    aria-hidden="true"
                    style={
                      avatar
                        ? {
                            backgroundImage: `url(${avatar})`,
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                            color: "transparent",
                          }
                        : undefined
                    }
                  >
                    {avatar ? "" : initials(name || user.displayName)}
                  </span>
                </button>
                <div>
                  <strong>{name || "你的名字"}</strong>
                  <small>{user.email || "you@company.com"}</small>
                </div>
              </div>
              <div className="field">
                <label htmlFor="name">显示名称</label>
                <input
                  id="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="你的名字"
                  maxLength={60}
                />
                <span className="field-help">
                  简短、容易认出的名字效果最好。
                </span>
              </div>
              <div className="field">
                <label htmlFor="avatar">头像</label>
                <div className="avatar-upload-row">
                  <span
                    className="avatar avatar-preview"
                    aria-hidden
                    style={
                      avatar
                        ? {
                            backgroundImage: `url(${avatar})`,
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                            color: "transparent",
                          }
                        : undefined
                    }
                  >
                    {avatar ? "" : initials(name || user.displayName)}
                  </span>
                  <label className="avatar-upload-button" title="上传头像">
                    {avatarUploading ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <ImagePlus size={16} />
                    )}
                    <span>{avatarUploading ? "上传中…" : avatar ? "更换头像" : "上传头像"}</span>
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void uploadAvatar(file);
                        event.target.value = "";
                      }}
                    />
                  </label>
                  {avatar && !avatarUploading && (
                    <button
                      type="button"
                      className="avatar-clear-button"
                      onClick={() => { void clearAvatar(); }}
                    >
                      移除
                    </button>
                  )}
                </div>
                <div className="avatar-random-row">
                  <label className="avatar-color-picker" title="设置随机头像主色">
                    <input type="color" value={themeColor} onChange={(event) => { const color = event.target.value; setThemeColor(color); if (avatar.startsWith("data:image/svg+xml,")) generateAvatar(color); }} aria-label="随机头像颜色" />
                    <span>头像颜色</span>
                  </label>
                  <button type="button" className="secondary-button avatar-random-button" onClick={() => generateAvatar()} title="随机生成头像">
                    <Dices size={15} />
                    <span>随机生成</span>
                  </button>
                </div>
                {avatarError && <span className="field-help avatar-error">{avatarError}</span>}
                <span className="field-help">
                  支持 png/jpg/webp/gif，单张不超过 2MB。上传后立即生效。
                </span>
              </div>
              <div className="field">
                <label htmlFor="avatar-url">或粘贴图片链接</label>
                <input
                  id="avatar-url"
                  value={avatar.startsWith("/api/avatars/") ? "" : avatar}
                  onChange={(event) => setAvatar(event.target.value)}
                  placeholder="可选的可信图片链接"
                />
              </div>
              <div className="save-row">
                {saved && (
                  <span className="save-note">
                    <Check
                      size={12}
                      style={{ verticalAlign: "-2px", marginRight: 4 }}
                    />
                    已保存
                  </span>
                )}
                {savedError && <span className="save-note">{savedError}</span>}
                <button className="primary-button" onClick={() => void save()}>
                  保存更改
                </button>
              </div>
            </section>
          )}
          {tab === "preferences" && (
            <section className="settings-section">
              <h2>主题色</h2>
              <p>选择一个主题色，应用到侧栏渐变、按钮和强调元素。</p>
              <div className="theme-picker">
                <div className="theme-custom-row">
                  <label className="theme-color-input" title="选择自定义颜色">
                    <input
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/.test(themeColor) ? themeColor : "#c7613d"}
                      onChange={(event) => applyTheme(event.target.value)}
                      aria-label="自定义主题色"
                    />
                    <span className="theme-swatch-current" style={{ background: themeColor }} />
                  </label>
                  <input
                    type="text"
                    className="theme-hex-input"
                    value={hexInput}
                    onChange={(event) => commitHex(event.target.value)}
                    onBlur={() => { if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hexInput.trim())) setHexInput(themeColor); }}
                    maxLength={7}
                    spellCheck={false}
                    placeholder="#c7613d"
                    aria-label="主题色 hex 值"
                  />
                </div>
                <div className="theme-presets">
                  {themePresets.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`theme-preset${color.toLowerCase() === themeColor.toLowerCase() ? " active" : ""}`}
                      style={{ background: color }}
                      aria-label={`主题色 ${color}`}
                      onClick={() => applyTheme(color)}
                    />
                  ))}
                </div>
              </div>
              <div className="theme-preview" style={{ background: `linear-gradient(135deg, ${themeColor}, #ffffff)` }}>
                <span className="theme-preview-chip" style={{ background: themeColor }}>按钮预览</span>
              </div>
              <h2 style={{ marginTop: 28 }}>工作区默认项</h2>
              <p>几项安静的偏好，用来调整 EchoTalking 的感觉。</p>
              <div className="toggle-row">
                <div className="toggle-copy">
                  <strong>专注模式</strong>
                  <span>阅读时尽量收起房间装饰。</span>
                </div>
                <button
                  className={`switch${focusMode ? " on" : ""}`}
                  aria-label="切换专注模式"
                  aria-pressed={focusMode}
                  onClick={() => setFocusMode((value) => !value)}
                >
                  <i />
                </button>
              </div>
              <div className="toggle-row">
                <div className="toggle-copy">
                  <strong>回车发送</strong>
                  <span>在输入框中按回车直接发送消息。</span>
                </div>
                <button
                  className={`switch${enterToSend ? " on" : ""}`}
                  aria-label="切换回车发送"
                  aria-pressed={enterToSend}
                  onClick={() => setEnterToSend((value) => !value)}
                >
                  <i />
                </button>
              </div>
              <div style={{ marginTop: 22 }}>
                <span className="admin-badge">
                  <ShieldCheck size={12} /> 会话已保护
                </span>
                <p style={{ marginTop: 10 }}>
                  EchoTalking 使用 HttpOnly 会话 Cookie。你的密码和房间权限都保存在服务器上。
                </p>
              </div>
            </section>
          )}
        </div>
      </div>
      {avatarPreview && (
        <div className="image-lightbox" onClick={() => setAvatarPreview(null)}>
          <div className="image-lightbox-inner" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="image-lightbox-close" aria-label="关闭头像预览" onClick={() => setAvatarPreview(null)}>
              <X size={16} />
            </button>
            <img src={avatarPreview} alt="头像大图" />
          </div>
        </div>
      )}
    </div>
  );
}
