# EchoTalking 项目重命名方案

## 1. 状态与目标

- 状态：设计方案，尚未实施
- 当前品牌/机器标识：Smart Chat / `smart-chat`
- 目标品牌/机器标识：EchoTalking / `echo-talking`
- 范围：用户品牌、npm、Docker、GitHub、GHCR 和腾讯云部署

重命名不能通过一次全局替换完成。数据库、Docker 数据卷、生产目录、环境变量和历史镜像涉及持久数据及回滚，必须分阶段迁移。

## 2. 命名约定

| 场景 | 目标 | 策略 |
|---|---|---|
| 产品展示名 | `EchoTalking` | 用户可见位置统一修改 |
| GitHub 仓库 | `echo-talking` | 仓库改名后更新所有 remote |
| npm package | `echo-talking` | 同步 lockfile |
| GHCR 镜像 | `ghcr.io/saxon-y/echo-talking` | 新旧路径双发过渡 |
| Compose 服务 | `web/worker/postgres/caddy` | 保持职责名 |
| 腾讯云目录 | `/opt/echo-talking` | 新目录部署，不原地移动 |
| 数据库/用户 | `smart_chat` | 第一阶段保留 |
| Docker volume | 现有名称 | 显式复用，避免空库 |
| 旧环境变量 | 兼容保留 | 下一主版本再删除 |

原则：用户可见品牌优先统一；机器新标识统一为 `echo-talking`；持久化基础设施以数据安全和兼容为先。

## 3. 阶段一：用户可见品牌

修改页面 metadata、登录/注册/聊天/设置/管理台、错误页、README、文档、Logo、favicon、PWA manifest、通知和邮件模板中的品牌。

边界：不修改 Prisma migration、数据库、数据卷、环境变量、协议标识和历史审计内容。

验证：

```bash
rg -ni 'smart chat|smart-chat' src public README.md docs
npm run lint
npm run typecheck
npm test
npm run build
```

搜索结果应形成允许保留清单，区分技术兼容标识和用户文案遗漏。

## 4. 阶段二：项目与构建标识

修改 `package.json`/lockfile、Docker 本地镜像名、Makefile 文案、部署日志、备份名前缀、部署锁和新建默认路径。

Compose 的 `web`、`worker`、`runtime-worker`、`postgres`、`caddy` 保持不变，它们是职责而非品牌。

验证：

```bash
npm ci
npm run build
docker compose config --quiet
docker compose build web
make help
bash -n scripts/redeploy.sh
```

## 5. 阶段三：GitHub 仓库改名

在仓库 `Settings -> General -> Repository name` 改为 `echo-talking`。随后更新开发机和服务器：

```bash
git remote set-url origin git@github.com:saxon-y/echo-talking.git
git remote -v
git fetch origin
```

同时核验分支保护、Required Checks、Actions 权限、`production` Environment、Deploy Key、GitHub App、Webhook、README badge 和外部回调。

GitHub 旧 URL 的重定向只能作为过渡，不应长期依赖。仓库改名不会自动完成 GHCR 路径迁移。

## 6. 阶段四：GHCR 镜像迁移

目标：

```text
ghcr.io/saxon-y/echo-talking:sha-<commit>
```

至少一个发布周期同时发布：

```text
ghcr.io/saxon-y/smart-chat:sha-<commit>
ghcr.io/saxon-y/echo-talking:sha-<commit>
```

生产使用不可变 SHA 标签和 digest。新路径完成 pull、migration、启动和回滚演练后再停止旧路径发布；历史镜像不能立即删除。

## 7. 阶段五：环境变量兼容

旧变量如 `SMART_CHAT_IMAGE`、`SMART_CHAT_IMAGE_TAG` 不直接删除。新增：

```text
ECHO_TALKING_IMAGE
ECHO_TALKING_IMAGE_TAG
```

过渡期优先级：新变量 -> 旧变量 -> 默认值。完成一个稳定发布周期后，在下一主版本清理旧变量。

`SESSION_SECRET`、`AI_CONFIG_ENCRYPTION_KEY`、`AGENT_WORKER_SECRET` 是通用职责名，无需更改，更不能因重命名重新生成，否则会导致会话失效或已有 Provider 密钥无法解密。

## 8. 阶段六：腾讯云目录迁移

不要移动运行中的 `/opt/smart-chat`。执行：

1. 备份 PostgreSQL 和 Artifact。
2. 在 `/opt/echo-talking` clone 新仓库。
3. 安全迁移 `.env`，不通过 Git。
4. 配置新 GHCR SHA 镜像。
5. 显式复用原数据卷。
6. 检查 `docker compose config`。
7. 在维护窗口停止旧项目并启动新项目。
8. 验证 HTTPS、登录、历史数据、Worker 和 Agent。
9. 保留旧目录观察，但禁止两个目录同时管理相同容器。

## 9. Compose 项目名与数据卷风险

Compose 默认从目录名推导项目名。迁移目录后直接启动可能创建全新空卷，使用户、房间和聊天记录看起来消失。

迁移前检查：

```bash
docker volume ls | grep smart-chat
docker compose ls
```

过渡方案可以固定旧项目名：

```bash
docker compose -p smart-chat --profile worker up -d
```

长期方案是在生产 Compose 中显式声明现有 external volume 或固定卷名。必须在备份和测试环境验证后变更。没有必要仅为品牌一致性复制数据库卷。

## 10. 数据库命名

第一阶段保留数据库和角色 `smart_chat`。它们不可见，改名却涉及 `DATABASE_URL`、ownership、healthcheck、migration、备份和恢复流程，收益低且可能误连空库。

未来只有在数据库基础设施迁移、租户拆分或合规要求出现时，才单独设计数据库改名。

## 11. 禁止全局替换的内容

- Prisma migration 和 Git 历史。
- 数据库名称、角色及 ownership。
- 现有 Docker volume、网络和证书状态。
- 已发布镜像、历史标签与部署记录。
- 旧环境变量的兼容逻辑。
- 外部 OAuth、Webhook 和回调 URL。
- 用户消息、Artifact 和审计正文。
- 已加密 Provider 密钥。
- 历史 ADR 中对旧决策的描述。

## 12. 建议提交拆分

1. 统一 EchoTalking 用户可见品牌。
2. 迁移 npm 与本地构建标识。
3. 兼容 EchoTalking 部署环境变量。
4. 更新 GitHub 与 GHCR 发布路径。
5. 固定生产 Compose 项目名和数据卷。
6. 迁移腾讯云目录和运维文档。

每个提交独立验证；不要在同一提交中混合视觉品牌、数据库 migration 和生产基础设施切换。

## 13. 推荐上线顺序

```text
冻结命名
-> 用户品牌
-> npm/Docker 标识兼容
-> GitHub 改名并更新 remote
-> GHCR 新旧路径双发
-> 固定 Compose 项目名/卷
-> /opt/echo-talking 新目录部署
-> 验证历史数据与 HTTPS
-> 停止旧镜像发布
-> 下一主版本清理旧变量
```

## 14. 验证矩阵

### 应用

- 登录、注册、聊天、设置和管理台显示 EchoTalking。
- 浏览器标题、favicon、移动端和错误状态一致。
- lint、typecheck、test、build 通过。

### 数据

- 原管理员可以登录。
- 原房间、消息、Artifact 和 Run 仍存在。
- Provider 密钥仍可解密。
- Prisma migration 状态正常。

### Docker 与公网

- Web/Worker 使用同一 SHA 镜像。
- Compose 挂载原 PostgreSQL、Artifact 和 Caddy 卷。
- HTTPS 有效，HTTP 自动跳转。
- Worker 内部调用无 401。

### GitHub/GHCR

- 新 remote 可 fetch/push。
- 分支保护、Environment 和 Deploy Key 有效。
- 新镜像可拉取，旧 SHA 仍能回滚。
- 部署记录可追踪 commit、tag 和 digest。

## 15. 回滚

- 品牌回滚：回滚应用 commit，无需恢复数据库。
- 镜像回滚：切换到上一 SHA，前提是数据库 schema 向后兼容。
- 目录回滚：停止新目录容器，用同一项目名和数据卷从旧目录启动旧镜像。
- 数据恢复：仅在数据损坏且向前修复不可行时执行，先停止写流量并走灾难恢复流程。

数据库 migration 必须采用 expand/contract，不能假设应用代码回滚等于数据库自动回滚。

## 16. 完成验收清单

- [ ] 用户页面统一显示 EchoTalking。
- [ ] npm 和新 Docker/GHCR 标识使用 `echo-talking`。
- [ ] GitHub 仓库改名并更新所有 remote/integration。
- [ ] 新旧 GHCR 镜像完成过渡双发。
- [ ] 腾讯云从 `/opt/echo-talking` 部署不可变 SHA 镜像。
- [ ] Compose 明确复用正确数据卷。
- [ ] 原用户、房间、聊天记录、Artifact 和 Provider 配置可用。
- [ ] HTTPS、消息、Worker 和 Agent 端到端通过。
- [ ] 旧目录、旧镜像和旧变量有明确下线时间。
- [ ] 已完成一次镜像回滚演练。

## 17. 推荐决策

先改用户可见品牌，再迁移构建与仓库标识，最后切换生产目录。数据库名、数据库用户和已有数据卷保持不变，除非未来有独立基础设施迁移需求。

全过程以“原数据始终可见、历史镜像可回滚、生产 Secret 不离开服务器”为硬约束。
