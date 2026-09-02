# Smart Chat Docker 化 Node 服务部署指南

## 1. 目标

本方案不再在宿主机直接执行 `npm start`。Next.js Web、Agent Worker 和 PostgreSQL 都由 Docker Compose 管理，并通过 Docker 私有网络互通。

```text
公网 :443
  -> 宿主机 Caddy
  -> 127.0.0.1:3000
  -> web 容器 :3000
  -> postgres 容器 :5432

worker 容器
  -> http://web:3000/api/internal/agent-worker
  -> postgres:5432
```

宿主机映射：

- `127.0.0.1:3000 -> web:3000`，供本机 Caddy 反向代理。
- `127.0.0.1:5432 -> postgres:5432`，供本机维护工具访问。
- 公网只开放 80 和 443，不开放 3000、3011、5432。

## 2. 新增部署文件

- 根Docker 镜像定义：仓库根目录 `Dockerfile`。
- 构建排除清单：仓库根目录 `.dockerignore`。
- 服务编排：仓库根目录 `compose.yaml`。

镜像基于 Node.js 22，构建与运行分阶段进行。镜像内包含构建后的 Next.js、Prisma Client、Worker 脚本及 Runtime 代码；运行容器使用非 root 的 `node` 用户。

## 3. 配置环境变量

```bash
cd /opt/smart-chat
cp .env.example .env
chmod 600 .env
```

Docker 数据库连接由 `compose.yaml` 覆盖为服务名 `postgres`。`.env` 中至少配置：

```env
POSTGRES_PASSWORD="使用 openssl rand -hex 32 生成"
POSTGRES_PORT="5432"
APP_PORT="3000"
SMART_CHAT_IMAGE_TAG="latest"

SESSION_SECRET="使用 openssl rand -base64 48 生成"
AI_CONFIG_ENCRYPTION_KEY="使用 openssl rand -hex 32 生成"
AGENT_WORKER_SECRET="使用 openssl rand -base64 48 生成"

COOKIE_SECURE=true
AGENT_RUNTIME_MODE=legacy
AI_PROVIDER_HOST_ALLOWLIST="api.openai.com,generativelanguage.googleapis.com"
ARTIFACT_RETENTION_DAYS=30
```

数据库密码使用十六进制字符串，可以避免连接 URL 中的 `/`、`@`、`:` 等字符需要额外编码。Web 和 Worker 的 `DATABASE_URL` 都是：

```text
postgresql://smart_chat:${POSTGRES_PASSWORD}@postgres:5432/smart_chat?schema=public
```

这里的 `postgres` 是 Compose 服务名，由 Docker DNS 自动解析，不是公网域名。

## 4. 构建镜像

```bash
docker compose build web worker
```

检查最终配置：

```bash
docker compose config
```

`docker compose config` 会展开环境变量，输出可能包含数据库密码，因此不要把输出上传到日志、工单或聊天工具。

### 4.1 使用 Makefile 自动部署

仓库根目录提供 `Makefile`。完成 `.env` 配置后，可用一条命令完成配置检查、镜像构建、PostgreSQL 启动、Prisma migration，以及 Web 和传统 Worker 启动：

```bash
make deploy
```

常用命令：

```bash
make help         # 查看命令说明
make deploy-web   # 只部署 Web，不启动传统 Worker
make status       # 查看容器状态
make logs         # 跟踪 Web、Worker 和数据库日志
make verify       # 检查 Compose 并探测本地 Web 端口
make backup       # 备份 PostgreSQL 到 backups/
make update       # git pull --ff-only 后重新构建和部署
make stop         # 停止容器，但不删除数据卷
```

`make deploy` 不会执行 seed，不会删除命名卷，也不会生成或覆盖生产密钥。首次部署前仍需人工创建并审核 `.env`。

## 5. 启动数据库

```bash
docker compose up -d postgres
docker compose ps
docker compose logs --tail=100 postgres
```

Compose 会等待 `pg_isready` 健康检查成功，再启动依赖数据库的 Web。

如果 PostgreSQL 数据卷以前已经用默认密码创建，修改 `POSTGRES_PASSWORD` 不会自动修改库内密码。全新服务器不会遇到此问题；已有数据时需要使用 `ALTER ROLE`，不能直接删除数据卷。

## 6. 执行数据库迁移

使用已经构建好的应用镜像运行一次性迁移容器：

```bash
docker compose run --rm web npx prisma migrate deploy
```

仅在需要演示数据时执行：

```bash
docker compose run --rm web npm run db:seed
```

生产环境不要用 `prisma db push` 替代 migration。

## 7. 启动 Web 和 Worker

启动 Web：

```bash
docker compose up -d web
```

启动传统 Agent Worker：

```bash
docker compose --profile worker up -d worker
```

也可以一次启动：

```bash
docker compose --profile worker up -d postgres web worker
```

检查状态和日志：

```bash
docker compose ps
docker compose logs --tail=100 web
docker compose logs --tail=100 worker
curl -I http://127.0.0.1:3000
```

Worker 在容器内使用 `http://web:3000/api/internal/agent-worker`，不再通过宿主机或公网访问 Web。

## 8. HTTPS 反向代理

Caddy 仍运行在宿主机，因为 Web 只映射到宿主机回环地址。假设公网 IP 是 `43.123.45.67`：

```caddy
43-123-45-67.sslip.io {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000

    header {
        Strict-Transport-Security "max-age=31536000"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}
```

应用配置并检查：

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
curl -I https://43-123-45-67.sslip.io
```

腾讯云安全组开放 80/443，同时确保未开放 3000、3011、5432。

## 9. 数据持久化

Compose 使用两个命名卷：

| 卷 | 内容 |
|---|---|
| `smart-chat-postgres` | PostgreSQL 数据文件 |
| `smart-chat-artifacts` | 图片和大结果 Artifact |

重新创建容器不会删除命名卷。执行 `docker compose down -v` 会删除卷和数据，生产环境禁止使用该命令。

备份 PostgreSQL：

```bash
docker compose exec -T postgres pg_dump -U smart_chat -d smart_chat > smart-chat-backup.sql
```

Artifact 卷也必须定期备份，数据库备份不能替代 Artifact 文件备份。

## 10. 更新部署

```bash
cd /opt/smart-chat
git pull --ff-only
docker compose build web worker
docker compose run --rm web npx prisma migrate deploy
docker compose up -d web
docker compose --profile worker up -d worker
docker image prune -f
```

先构备份，再迁移数据库。构建失败时旧容器仍然运行；新容器启动后检查日志、登录、消息发送和 Worker 处理，再清理旧镜像。

## 11. 常用运维命令

```bash
# 查看服务
docker compose ps

# 持续查看日志
docker compose logs -f web worker postgres

# 重启应用，不重启数据库
docker compose restart web worker

# 停止应用，保留数据卷
docker compose down

# 检查容器网络中的数据库
docker compose exec web node -e 'require("dns").lookup("postgres", console.log)'

# 检查宿主机监听端口
sudo ss -lntp
```

## 12. Self-hosted Runtime

`runtime-worker` 已复用同一个生产镜像，但只有在实现并配置 `SELF_HOSTED_RUNTIME_EXECUTOR` 后才能启用：

```bash
docker compose --profile self-hosted-runtime up -d runtime-worker
```

如果 executor 是宿主机绝对路径，容器无法直接访问，必须将模块构建进镜像或显式只读挂载到容器内，并把变量改成容器内路径。传统 `AGENT_RUNTIME_MODE=legacy` 部署不需要启动该服务。

## 13. 验收清单

- [ ] `docker compose ps` 中 PostgreSQL 为 healthy，Web 和 Worker 为 running。
- [ ] `curl http://127.0.0.1:3000` 在服务器本机成功。
- [ ] 公网只能通过 HTTPS 访问，3000/5432 无法从公网连接。
- [ ] Web 使用 `postgres:5432`，Worker 使用 `web:3000`。
- [ ] 用户能登录、发送消息并收到 Agent 回复。
- [ ] 重启 Docker 或服务器后容器自动恢复。
- [ ] PostgreSQL 与 Artifact 卷均已有可恢复备份。
