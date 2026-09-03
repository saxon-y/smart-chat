# Smart Chat

基于 Next.js 16、TypeScript、PostgreSQL 的多人文字聊天室。支持注册登录、头像昵称、公开房间、加入/退出、结构化 `@` 提及、默认 AI 成员“大聪明”和管理员 AI 模型配置。

## 技术栈

- Next.js App Router + React 19
- Prisma + PostgreSQL
- Argon2id + HttpOnly JWT/数据库 Session
- OpenAI-compatible 本地 AI 网关
- Vitest + ESLint + TypeScript

## 本地启动

要求 Node.js 20.9+、npm，以及可选的 Docker Desktop。

```bash
cp .env.example .env
docker compose up -d postgres
npm run db:push
npm run db:seed
npm run dev
```

打开 http://localhost:3000 。种子账号：

- 管理员：`admin@example.com` / `.env` 中的 `SEED_ADMIN_PASSWORD`
- 普通用户：`demo@example.com` / `.env` 中的 `SEED_DEMO_PASSWORD`

请在首次启动前替换 `.env` 中的 session、AI 配置加密密钥和种子密码。

## 认证与邮箱验证码

密码注册需要先发送并填写 6 位邮箱验证码。开发环境默认使用 `EMAIL_PROVIDER=console`，验证码会输出到运行 `npm run dev` 的终端，不会真正发送邮件。正式发信可选择：

- `EMAIL_PROVIDER=smtp`：配置 `SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASSWORD` 和 `EMAIL_FROM`。
- `EMAIL_PROVIDER=resend`：配置 `RESEND_API_KEY` 和已验证域名下的 `EMAIL_FROM`。

第三方登录支持 Google 和 Microsoft，配置对应 Client ID/Secret 后，登录和注册页面会自动显示按钮：

```text
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
MICROSOFT_CLIENT_ID="..."
MICROSOFT_CLIENT_SECRET="..."
MICROSOFT_TENANT="consumers"
```

本地 OAuth 回调地址：

```text
http://localhost:3000/api/auth/oauth/google/callback
http://localhost:3000/api/auth/oauth/microsoft/callback
```

生产环境必须配置 HTTPS `APP_ORIGIN`、独立的 `OAUTH_STATE_SECRET` 和 `EMAIL_CODE_SECRET`。第三方登录仅申请 `openid email profile`，不读取用户邮箱内容。

如果本机浏览器通过代理访问 Google/Microsoft，但 Node.js 后端无法直连，可单独配置 OAuth 代理，例如 `OAUTH_HTTP_PROXY="http://127.0.0.1:7897"`。代理会接触 OAuth 网络流量，只应使用自己信任的本机代理。

## 本地 AI 服务

管理员登录后访问 `/admin`，配置 OpenAI-compatible 服务地址、模型和 API Key。默认种子配置指向 `http://localhost:4000/v1`。当消息结构化提及“大聪明”时，服务端只读取当前房间最近 30 条消息并调用：

```text
POST {baseUrl}/chat/completions
```

### Gemini 图片生成

管理员可在“模型配置”中新建图片模型，并填写：

- 提供方类型：`Gemini 图片（GEMINI_IMAGES）`
- 接口地址：`https://generativelanguage.googleapis.com/v1beta`
- 模型 ID：`gemini-2.5-flash-image`（或 Google 当前开放的原生图片生成模型）
- 密钥：Google AI Studio 创建的 API Key

保存后将该模型绑定到 `IMAGE` 类型 Agent，并把 Agent 加入房间。API Key 会使用现有 AES-256-GCM 机制加密存储；服务端通过 `x-goog-api-key` 调用 Gemini `generateContent`，不会把密钥发送到浏览器。聊天框选择的 `1:1`、`3:2` 或 `2:3` 比例会原样传给 Gemini。

生产环境还需把 `generativelanguage.googleapis.com` 加入 `AI_PROVIDER_HOST_ALLOWLIST`，例如：`AI_PROVIDER_HOST_ALLOWLIST="api.openai.com,generativelanguage.googleapis.com"`。

## 专职 Agent 与图片生成

房间支持一个后台总管 Agent。没有显式提及时，总管只从当前房间内的 Agent 中选择能力匹配者；显式 `@Agent` 会绕过总管直接执行。种子数据包含漫画师、人像师和风景师，首次使用前需要在管理后台为它们绑定 `OPENAI_IMAGES` 或兼容图片模型，并将 Agent 加入房间。

开发环境会在 Next.js 进程内唤醒持久化任务。生产环境必须独立运行 worker，并配置相同的 `AGENT_WORKER_SECRET`：

```bash
npm run worker
```

生产环境还必须配置 `AI_PROVIDER_HOST_ALLOWLIST` 和持久化私有卷 `ARTIFACT_STORAGE_DIR`。生成图片只能通过需要登录和房间成员权限的 `/api/artifacts/:id` 读取。

Artifact storage 当前提供无额外依赖的本地私有卷适配器（`ARTIFACT_STORAGE_BACKEND=local`）。生产部署将 `ARTIFACT_STORAGE_DIR` 挂载到仅应用和 worker 可读写的持久化卷；S3 兼容后端暂未启用。已标记删除且超过保留期的文件可通过 `ARTIFACT_RETENTION_DAYS` 和 `npm run artifacts:cleanup` 清理。

Compose 中的 `worker` 使用同一份源码和 `npm run worker`，通过 profile 启动：`docker compose --profile worker up -d worker`。生产拓扑应运行一个 Next.js app、一个或多个独立 worker、PostgreSQL，以及 app/worker 共享的私有 artifact 卷；worker 的 `AGENT_WORKER_URL` 应指向 app 的内部 worker API，双方使用同一个 `AGENT_WORKER_SECRET`。

API Key 使用 AES-256-GCM 加密后存入数据库，不会返回浏览器。生产环境建议将 `AI_CONFIG_ENCRYPTION_KEY` 放在独立 secret manager 中。

## 验证

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm audit
```

## 文档

总览（含出图）：

- [产品功能](docs/产品/产品功能.md)
- [技术架构](docs/架构/技术架构.md)
- [AI 运行时架构](docs/架构/AI运行时架构.md)
- [文档地图](docs/项目概览.md)

设计与实施原文：

- [PRD](docs/产品/产品需求.md)
- [技术与实施方案](docs/架构/实施方案.md)
- [测试规格](docs/运行时/测试规格.md)
