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

## 本地 AI 服务

管理员登录后访问 `/admin`，配置 OpenAI-compatible 服务地址、模型和 API Key。默认种子配置指向 `http://localhost:4000/v1`。当消息结构化提及“大聪明”时，服务端只读取当前房间最近 30 条消息并调用：

```text
POST {baseUrl}/chat/completions
```

API Key 使用 AES-256-GCM 加密后存入数据库，不会返回浏览器。生产环境建议将 `AI_CONFIG_ENCRYPTION_KEY` 放在独立 secret manager 中。

## 验证

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm audit
```

## 规划文档

- [PRD](docs/PRD.md)
- [技术与实施方案](docs/IMPLEMENTATION_PLAN.md)
- [测试规格](docs/TEST_SPEC.md)

V1 仅支持文字聊天。图片、文件和富文本保留在后续版本。
