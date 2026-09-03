# GitHub Actions + GHCR + 腾讯云部署方案

## 1. 文档状态

- 状态：设计方案，尚未实施
- 目标环境：腾讯云 CVM、Docker Compose
- 镜像仓库：GitHub Container Registry（GHCR）
- 发布分支：`main`
- 本文不修改现有 GitHub Actions、Compose、Dockerfile 或部署脚本

## 2. 目标

将 Docker 镜像构建从腾讯云生产服务器移到 GitHub Actions。生产服务器只负责拉取已验证的不可变镜像、执行数据库 migration 和替换容器。

```text
Pull Request
  -> CI 测试

main 更新
  -> CI 测试通过
  -> GitHub Actions 构建镜像
  -> 推送 GHCR（commit SHA 标签）
  -> 生产环境审批
  -> SSH 到腾讯云
  -> 备份 PostgreSQL
  -> docker compose pull
  -> prisma migrate deploy
  -> docker compose up -d
  -> HTTPS 冒烟验证
```

目标收益：

- 生产服务器不再运行 `npm ci` 和 Next.js 构建。
- 构建产物只生成一次，测试、部署和回滚使用同一镜像。
- 每次部署精确绑定 Git commit。
- 回滚只需切换镜像标签，无需重新编译。
- 减少生产服务器访问 npm 和 Docker Hub 的依赖。

## 3. 职责边界

### 3.1 GitHub Actions

- 安装依赖并生成 Prisma Client。
- 执行 lint、typecheck、测试和生产构建。
- 构建应用镜像。
- 生成镜像 provenance、SBOM 和漏洞扫描结果。
- 使用 commit SHA 推送到 GHCR。
- 经生产 Environment 审批后触发远程部署。

### 3.2 GHCR

- 保存不可变应用镜像。
- 提供 commit SHA、分支和发布标签。
- 为腾讯云服务器提供只读拉取权限。
- 按保留策略清理旧的非发布镜像。

### 3.3 腾讯云服务器

- 保存生产 `.env` 和 GHCR 只读凭据。
- 运行 Caddy、Web、Worker 和 PostgreSQL 容器。
- 在更新前备份数据库。
- 拉取指定镜像，执行 migration，并重建容器。
- 执行本机和公网健康检查。

服务器不负责构建镜像，也不保存 GitHub Actions 写入 GHCR 的权限。

## 4. 镜像设计

推荐镜像名称：

```text
ghcr.io/saxon-y/smart-chat
```

每个成功构建至少发布两个标签：

```text
ghcr.io/saxon-y/smart-chat:sha-<完整或短commit-sha>
ghcr.io/saxon-y/smart-chat:main
```

正式发布可以增加：

```text
ghcr.io/saxon-y/smart-chat:v1.2.0
```

生产 Compose 必须使用 SHA 标签作为部署真值，不建议直接部署可变的 `latest` 或 `main`：

```env
SMART_CHAT_IMAGE=ghcr.io/saxon-y/smart-chat
SMART_CHAT_IMAGE_TAG=sha-a1b2c3d4...
```

对应镜像引用：

```text
${SMART_CHAT_IMAGE}:${SMART_CHAT_IMAGE_TAG}
```

`main` 用于人工查看最新构建，SHA 标签用于部署、审计和回滚。

## 5. 工作流拆分

建议使用三个工作流，避免测试、镜像发布和生产变更耦合在一个大型 Job 中。

```text
.github/workflows/
├── ci.yml
├── publish-image.yml
└── deploy-production.yml
```

### 5.1 CI

触发条件：

- Pull Request 创建或更新。
- `main` 分支 push。

执行：

```text
npm ci
prisma generate
prisma migrate deploy（临时 PostgreSQL）
lint
typecheck
test
next build
```

CI 只需要测试数据库和测试密钥，不能访问生产 `.env`。

建议将 CI 设为 `main` 分支保护的 Required Check，禁止绕过失败测试直接合并。

### 5.2 镜像发布

触发条件：

- `main` 的 CI 成功。
- 或创建版本 tag。

执行：

1. Checkout CI 已验证的准确 SHA。
2. 登录 GHCR。
3. 使用 BuildKit/Buildx 构建镜像。
4. 使用 GitHub Actions cache 加速 npm 和 Docker layer。
5. 推送 SHA 标签和 `main`/版本标签。
6. 扫描镜像漏洞。
7. 输出镜像 digest。

部署记录应同时保存 tag 和 digest：

```text
tag: sha-a1b2c3d4
digest: sha256:...
```

更严格的阶段可要求生产按 digest 拉取，防止标签被覆盖。

### 5.3 生产部署

触发条件：

- 镜像发布成功后自动进入 `production` Environment。
- 或通过 `workflow_dispatch` 手动指定一个已经存在的 SHA 标签。

执行：

1. 验证标签属于 `main` 历史且镜像存在。
2. 获取 GitHub Environment 审批。
3. 通过 SSH 连接腾讯云部署用户。
4. 将目标镜像标签作为参数传入远程部署命令。
5. 数据库备份。
6. `docker compose pull`。
7. 用目标镜像执行 `prisma migrate deploy`。
8. `docker compose up -d --force-recreate`。
9. 验证本地 HTTP、容器状态和公网 HTTPS。
10. 写入部署记录。

## 6. GitHub 权限设计

### 6.1 镜像发布权限

发布镜像的 Job 使用 GitHub 自动生成的 `GITHUB_TOKEN`：

```yaml
permissions:
  contents: read
  packages: write
  attestations: write
  id-token: write
```

其他 Job 默认只需要：

```yaml
permissions:
  contents: read
```

不要给整个 workflow 默认设置 `packages: write`。

### 6.2 生产 Environment

GitHub 仓库创建 `production` Environment，并配置：

- 必需审批人。
- 只允许 `main` 或版本 tag 部署。
- 部署 Secret。
- 可选等待时间和防误触规则。

### 6.3 GitHub Actions Secrets

建议配置：

| Secret | 用途 |
|---|---|
| `DEPLOY_HOST` | 腾讯云公网 IP |
| `DEPLOY_USER` | 非 root 部署用户 |
| `DEPLOY_SSH_PRIVATE_KEY` | Actions 到服务器的 SSH 私钥 |
| `DEPLOY_SSH_HOST_KEY` | 固定服务器 Host Key |

不要使用 `StrictHostKeyChecking=no`，也不要把生产 `.env`、数据库密码或 AI Key 放入 workflow。

## 7. 腾讯云服务器权限

创建专用部署用户，例如 `deploy`：

```bash
sudo adduser deploy
sudo usermod -aG docker deploy
sudo chown -R deploy:deploy /opt/smart-chat
```

该用户应具备：

- 读取 `/opt/smart-chat/.env`。
- 操作当前项目的 Docker Compose。
- 写入 `/opt/smart-chat/backups`。
- 从 GHCR 拉取镜像。

不应具备：

- GitHub Packages 写权限。
- 修改腾讯云安全组的权限。
- 默认免密 root shell。
- 读取无关应用 Secret 的权限。

## 8. GHCR 拉取认证

如果镜像设为公开，服务器可匿名拉取，但生产仍建议明确控制镜像可见性。

私有镜像需要一个只具备 `read:packages` 的 GitHub Fine-grained Token 或 Classic PAT。服务器执行一次：

```bash
printf '%s' "$GHCR_READ_TOKEN" | docker login ghcr.io -u <github-user> --password-stdin
```

认证信息保存在部署用户的 Docker credential store。不要把 Token 写入 `.env`、Compose 文件、命令行参数或部署日志。

长期建议使用组织级机器人账号或可轮换的只读凭据，不使用个人主账号的高权限 Token。

## 9. Compose 目标改造

实施阶段需要将当前固定本地镜像：

```yaml
image: smart-chat:${SMART_CHAT_IMAGE_TAG:-latest}
build:
  context: .
```

改为可配置远程镜像：

```yaml
image: ${SMART_CHAT_IMAGE:-ghcr.io/saxon-y/smart-chat}:${SMART_CHAT_IMAGE_TAG}
```

生产服务器不保留 `build`，或者使用独立的生产覆盖文件：

```text
compose.yaml
compose.production.yaml
```

推荐保留基础 Compose 的本地开发能力，通过生产覆盖文件移除 `build` 并指定 GHCR 镜像：

```bash
docker compose -f compose.yaml -f compose.production.yaml pull
```

Web、Worker 和 Runtime Worker 必须引用同一个 SHA 镜像，防止协议和数据库模型版本不一致。PostgreSQL 与 Caddy 继续使用锁定的官方镜像版本。

## 10. 远程部署顺序

推荐远程脚本接收明确的镜像标签：

```bash
./scripts/deploy-image.sh sha-a1b2c3d4
```

脚本顺序：

```text
验证 tag 格式
-> 获取部署锁
-> 检查 .env 和 Docker
-> 记录当前镜像标签
-> 备份 PostgreSQL
-> 拉取目标镜像
-> 用目标镜像执行 migration
-> 更新部署标签文件
-> 重建 Web/Worker/Caddy
-> 健康检查
-> 记录部署结果
```

镜像标签建议存储在服务器专用文件，例如：

```text
/opt/smart-chat/.deploy/image.env
```

内容：

```env
SMART_CHAT_IMAGE=ghcr.io/saxon-y/smart-chat
SMART_CHAT_IMAGE_TAG=sha-a1b2c3d4
```

使用临时文件加原子 `mv` 更新，避免部署中断留下半写文件。

## 11. Migration 策略

数据库 migration 是部署中风险最高的步骤。必须遵循 expand/contract：

1. Expand：先增加可空列、新表和兼容索引。
2. Deploy：新旧应用都能在扩展后的 schema 上运行。
3. Backfill：独立执行数据回填并观察。
4. Switch：应用切换读取/写入新结构。
5. Contract：确认没有旧应用后，再删除旧列或约束。

禁止在同一次普通发布中直接进行：

- 删除旧应用仍读取的列。
- 改名但不保留兼容字段。
- 长时间锁表的大规模回填。
- 不能安全中断的 schema/data 混合迁移。

`prisma migrate deploy` 成功不代表 migration 可以自动回滚。数据库优先采用向前修复。

## 12. 健康检查与发布成功标准

容器替换后依次检查：

```text
postgres healthy
web running
worker running
caddy running
HTTP 127.0.0.1:3000 返回 2xx/3xx
HTTPS PUBLIC_HOST 返回 2xx/3xx
响应由 Caddy 和 Next.js 提供
Worker 内部 API 无 401
```

建议增加独立、无敏感信息的 readiness endpoint，验证数据库连通和 migration 状态。当前只能用页面/登录跳转进行浅层检查。

发布成功后记录：

- Git commit SHA。
- 镜像 tag 和 digest。
- GitHub Actions run URL。
- migration 列表。
- 数据库备份文件。
- 部署开始/结束时间。
- 健康检查结果。

## 13. 并发与重复部署

GitHub Actions：

```yaml
concurrency:
  group: production-deploy
  cancel-in-progress: false
```

`cancel-in-progress: false` 避免部署在 migration 或容器替换过程中被新提交强制取消。服务器侧继续使用目录锁，形成双重保护。

如果部署 A 正在执行而部署 B 到达，B 应排队。不能允许两个 workflow 同时操作同一个 Compose 项目。

## 14. 回滚方案

发布前记录当前 SHA 标签，例如：

```text
previous=sha-1111111
target=sha-2222222
```

应用回滚：

```text
将 SMART_CHAT_IMAGE_TAG 改回 previous
-> docker compose pull
-> docker compose up -d --force-recreate web worker
-> 健康检查
```

Caddy 和 PostgreSQL 通常不随应用回滚。

回滚前必须确认数据库 schema 与旧镜像兼容。若新 migration 已删除旧字段，不能只切换旧镜像。此时应优先部署向前修复镜像，数据库备份恢复仅用于经过审批的灾难恢复。

## 15. 失败场景

| 失败点 | 预期行为 |
|---|---|
| CI 失败 | 不构建、不部署 |
| 镜像构建失败 | 旧生产容器不受影响 |
| GHCR 推送失败 | 不进入生产部署 |
| 生产审批拒绝 | 镜像保留，不部署 |
| SSH 失败 | 生产不变 |
| 数据库备份失败 | 中止部署 |
| 镜像拉取失败 | 旧容器继续运行 |
| migration 失败 | 不替换应用容器，人工检查数据库状态 |
| 新 Web 不健康 | 尝试切回 previous 镜像，前提是 schema 兼容 |
| 公网 HTTPS 失败 | 保留日志并判断是 Caddy、DNS、安全组还是应用问题 |

## 16. 安全与供应链

- GitHub Actions 使用固定 major 或完整 commit SHA 的官方 Action。
- PR 来源代码不应获得生产 Environment Secret。
- 镜像构建 Job 不接触生产数据库和 AI 密钥。
- 对镜像执行漏洞扫描和 SBOM 生成。
- 可使用 GitHub artifact attestation 或 Cosign 签名。
- 生产部署验证镜像 digest/签名后再拉取。
- GHCR Token 只允许读取指定包。
- SSH 私钥定期轮换，服务器固定 `known_hosts`。
- workflow 和生产 Environment 变更纳入代码审查。

## 17. 分阶段实施计划

### 阶段 A：CI 门禁

- 新增 `ci.yml`。
- 启用 `main` 分支保护。
- 验证测试数据库 migration、lint、typecheck、test、build。

### 阶段 B：GHCR 镜像发布

- 新增 `publish-image.yml`。
- 修改 Dockerfile 以提高缓存和最小化运行镜像。
- 发布 SHA 标签、`main` 标签、digest、SBOM。
- 在非生产机器验证 `docker pull` 和启动。

### 阶段 C：生产 Compose 远程镜像化

- 新增 `compose.production.yaml`。
- 新增 `.deploy/image.env` 约定。
- 新增 `deploy-image.sh`，不再在服务器执行 build。
- 保留现有 `redeploy.sh` 作为过渡/应急方案。

### 阶段 D：GitHub Actions 生产部署

- 创建 `production` Environment 和审批规则。
- 配置 SSH Secrets 和固定 Host Key。
- 新增 `deploy-production.yml`。
- 先仅允许手动 `workflow_dispatch`。

### 阶段 E：自动部署与演练

- 开启 `main` CI 成功后的自动部署。
- 演练重复消息、并发部署、GHCR 不可用、migration 失败和镜像回滚。
- 验证备份恢复和旧镜像保留策略。

## 18. 验收清单

- [ ] PR 无法绕过 CI 合并到 `main`。
- [ ] 只有 CI 成功的 SHA 能发布镜像。
- [ ] 镜像具有不可变 SHA 标签和可追踪 digest。
- [ ] 生产服务器不再构建应用镜像。
- [ ] Web 和 Worker 使用相同 SHA 镜像。
- [ ] 生产部署需要 Environment 审批。
- [ ] 并发部署在 GitHub 和服务器两侧都被阻止。
- [ ] migration 前生成有效数据库备份。
- [ ] 部署完成后执行本地和公网健康检查。
- [ ] 可以在 schema 兼容前提下切换到上一 SHA 镜像。
- [ ] GHCR、SSH 和生产 Secret 均遵循最小权限。

## 19. 推荐决策

采用“CI、镜像发布、生产部署”三个独立工作流。GitHub Actions 构建并推送 commit SHA 镜像，腾讯云仅拉取和运行该镜像。数据库继续由 PostgreSQL 作为权威状态，migration 使用 expand/contract；生产部署以 SHA 标签和 digest 为审计依据，以 GitHub Environment 审批、Actions concurrency 和服务器部署锁控制风险。

实施初期先使用手动 `workflow_dispatch`，完成至少一次正常部署、一次 migration 失败演练和一次镜像回滚后，再启用 `main` 自动部署。
