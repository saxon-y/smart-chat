# GitHub Actions + GHCR 实施与配合清单

仓库侧已经按《GitHub Actions 与 GHCR 部署方案》接到现有 Docker Compose 部署上。本地 `compose.yaml` + `make deploy` / `make redeploy` 仍可构建镜像；生产改为拉取 `ghcr.io/saxon-y/smart-chat:sha-...`。

当前**不会**在 `main` 推送后自动改生产。第一次切生产必须由你在 GitHub 上手动点 `Deploy production`。

下面按顺序做。标了「你来做」的步骤需要你在 GitHub 网页或腾讯云 SSH 里操作；我这边无法替你点审批、贴密钥或登录服务器。

## 0. 先看清新旧两条路径

| 场景 | 命令 | 谁构建镜像 |
|---|---|---|
| 本地开发 / 现网应急 | `make deploy` 或 `make redeploy` | 这台机器上的 Docker |
| 目标生产路径 | GitHub Actions 构建 → GHCR → `./scripts/deploy-image.sh sha-...` | GitHub Actions |

现网如果已经用 `make redeploy` 在跑，先不要停服务。按本清单做完第 1–6 步后，再用一次手动部署切到 GHCR。切过去之后，服务器上一旦出现 `.deploy/image.env`，`make redeploy` 会主动拒绝，避免又在生产机构建一次。

## 1. 你来做：把本次改动推到 `main`

这些文件需要进入 `saxon-y/smart-chat` 的 `main`，Actions 才会出现：

- `.github/workflows/ci.yml`
- `.github/workflows/publish-image.yml`
- `.github/workflows/deploy-production.yml`
- `compose.production.yaml`
- `scripts/deploy-image.sh`
- `scripts/prod-compose.sh`

推送后打开：

```text
https://github.com/saxon-y/smart-chat/actions
```

确认仓库没有禁用 Actions。若第一次提示 Enable Actions，点 Enable。

## 2. 你来做：打开 GITHUB_TOKEN 写 Packages 的权限

镜像推送使用自动生成的 `GITHUB_TOKEN`，**不要**再配一个高权限 PAT 给 Actions。

1. 打开 `https://github.com/saxon-y/smart-chat/settings/actions`
2. 拉到 **Workflow permissions**
3. 选 **Read and write permissions**
4. 保存

不改这一项时，CI 能过，但 `Publish image` 推 GHCR 会 `403`。

## 3. 你来做：确认 CI 在 GitHub 上变绿

推到 `main` 或开 PR 后，工作流 **CI** 应执行：

```text
npm ci → prisma generate → prisma migrate deploy（临时 PostgreSQL）
→ lint → typecheck → test → next build
```

CI 成功后，`main` 上的 **Publish image** 会自动开始。第一次镜像构建大约 5–15 分钟。

成功标志：

- Actions 里 `Publish image` 为绿色
- 摘要里有 `sha-<12位commit>` 和 digest
- 打开 `https://github.com/saxon-y/smart-chat/pkgs/container/smart-chat` 能看到镜像

如果 `Publish image` 没出现：看 CI 是否失败，或是否只跑了 PR（PR 成功不会发镜像，只有 `main` 的 push CI 成功才会发）。

## 4. 你来做：把 GHCR 包关联到仓库（第一次发布后）

1. 打开 `https://github.com/saxon-y/smart-chat/pkgs/container/smart-chat`
2. **Package settings** → 关联仓库 `saxon-y/smart-chat`
3. 可见性保持 **Private**
4. 确认 Actions 对该包有写权限（关联仓库后通常会继承）

生产服务器不要用匿名拉取。私有包必须做第 6 步的只读登录。

## 5. 你来做：创建 `production` Environment 和审批人

必须在**第一次手动部署之前**完成，否则 GitHub 会自动建一个没有审批的空 Environment。

1. 打开 `https://github.com/saxon-y/smart-chat/settings/environments`
2. **New environment**，名称必须是 `production`（和 workflow 一致）
3. 勾选 **Required reviewers**，加上你会点审批的 GitHub 账号
4. **Deployment branches** 选 **Selected branches**，只允许 `main`
5. 先不要填 Secret，等第 7 步生成 SSH 后再贴

可选 Environment 变量（建议加上）：

| Name | 值 | 用途 |
|---|---|---|
| `PUBLIC_HOST` | 现网域名，例如 `43-130-52-92.sslip.io` | Actions 从公网再做一次 HTTPS 检查 |
| `DEPLOY_PATH` | `/opt/smart-chat` | 服务器项目目录，可省略（默认就是这个路径） |

## 6. 你来做：生产机确认部署用户，并登录 GHCR

第一次切换时，**不要急着新建 `deploy` 用户**。把 `DEPLOY_USER` 设成你现在用来 `cd /opt/smart-chat && make redeploy` 的那个账号（常见是 `ubuntu`）。这个账号已经同时具备：

- `docker compose` 权限
- `git fetch origin` / `git pull` 权限
- 读写 `/opt/smart-chat/.env`、`backups/`

`scripts/deploy-image.sh` 仍会 `git fetch` 并把工作树对到镜像对应的 commit，所以部署用户必须能访问 GitHub 远程。换用户却没配 git 凭据时，SSH 部署会在拉代码这一步失败。

如果以后要拆成专用 `deploy` 用户，再执行：

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy
sudo chown -R deploy:deploy /opt/smart-chat
```

并给该用户单独配置 GitHub 只读 deploy key。`deploy` 需要读 `.env`、操作当前 Compose、写 `backups/` 和 `.deploy/`、从 GHCR 拉镜像。不要给它 GitHub Packages 写权限，也不要免密 root。

然后用**只读** Fine-grained Token 在服务器登录 GHCR（用你真正的部署用户执行，下面以 `$USER` 为例）：

1. 打开 `https://github.com/settings/personal-access-tokens`
2. 生成 Fine-grained token
3. Resource owner 选你的账号，Repository access 只给 `smart-chat`
4. Permissions 只开 **Packages: Read**
5. 有效期按你的轮换策略设，不要用无限期、不要勾 Contents/Admin

在服务器上执行一次（把 Token 贴进提示，不要写入 `.env` 或命令历史能看见的脚本）：

```bash
docker login ghcr.io -u saxon-y --password-stdin
```

粘贴 Token 后回车，再按 `Ctrl-D`。不要把 Token 写在命令行参数里。

验证（把标签换成 Actions 摘要里的真实值）：

```bash
docker pull ghcr.io/saxon-y/smart-chat:sha-<12位commit>
```

这一步只拉镜像，不替换正在跑的容器。

## 7. 你来做：生成 Actions → 服务器 的 SSH 密钥

在你的笔记本电脑执行，不要在生产机构建这把私钥：

```bash
ssh-keygen -t ed25519 -C "smart-chat-github-actions" -f ./smart-chat-deploy -N ""
```

会得到：

- `smart-chat-deploy`：私钥，只进 GitHub Environment Secret
- `smart-chat-deploy.pub`：公钥，放服务器

服务器（把 `ubuntu` 换成第 6 步确定的 `DEPLOY_USER`）：

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
cat ./smart-chat-deploy.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

如果公钥是在笔记本生成的，用 `ssh` 或 `scp` 传到服务器再追加。确保该用户能读 `.env`、能写 `.deploy/` 和 `backups/`。

取 Host Key（把 IP 换成现网公网 IP）：

```bash
ssh-keyscan -t ed25519,rsa 你的公网IP
```

整段输出原样保存，稍后贴到 `DEPLOY_SSH_HOST_KEY`。不要使用 `StrictHostKeyChecking=no`。

本机先测 SSH（应直接进入部署用户的 shell，且能执行 docker 和 git）：

```bash
ssh -i ./smart-chat-deploy -o IdentitiesOnly=yes ubuntu@你的公网IP 'cd /opt/smart-chat && docker compose version && git remote -v'
```

## 8. 你来做：写入 production Environment Secrets

打开 `https://github.com/saxon-y/smart-chat/settings/environments` → `production` → **Add secret**：

| Secret | 填什么 |
|---|---|
| `DEPLOY_HOST` | 腾讯云公网 IP |
| `DEPLOY_USER` | 第 6 步确定的用户，例如 `ubuntu` |
| `DEPLOY_SSH_PRIVATE_KEY` | `smart-chat-deploy` 私钥全文，包含 `BEGIN` / `END` 行 |
| `DEPLOY_SSH_HOST_KEY` | 上一步 `ssh-keyscan` 的完整输出 |

不要把生产 `.env`、数据库密码、AI Key 放进 Actions。

本地私钥用完后删掉或放进密码管理器，不要提交到 Git。

## 9. 你来做：服务器拉一次含新脚本的代码（仍不切流量）

此时现网容器还是旧的本地镜像，只更新仓库文件：

```bash
cd /opt/smart-chat
git status --short
git pull --ff-only
ls scripts/deploy-image.sh compose.production.yaml
```

如果工作区有本地改过的 tracked 文件，先看 `git diff`，不要用 `DEPLOY_ALLOW_DIRTY=1` 糊过去。

## 10. 你来做：第一次手动生产部署

1. 打开 `https://github.com/saxon-y/smart-chat/actions/workflows/deploy-production.yml`
2. **Run workflow**
3. `image_tag` 填 Publish image 摘要里的标签，例如 `sha-a1b2c3d4e5f6`
4. 不要填 `latest` 或 `main`
5. 点运行后，GitHub 会卡在 **Waiting for review**；你到 Environment 审批页点 **Approve**

远程脚本会按这个顺序做：

```text
把 git 工作树对到该 SHA
→ 备份 PostgreSQL
→ docker compose pull GHCR 镜像
→ prisma migrate deploy
→ 写入 .deploy/image.env
→ 重建 web / worker / caddy
→ 本机 HTTP、本机 HTTPS、公网 HTTPS、Worker 内部 API
```

PostgreSQL 数据卷不会删。Caddy 证书卷会保留。

切过去之后，服务器上不要直接执行不带 `-f` 的 `docker compose up`：那会自动加载 `compose.override.yaml` 并重新本地构建。日常只用：

```bash
./scripts/prod-compose.sh --profile worker ps
make deploy-image TAG=sha-...
```

成功标志：

- Actions 绿色
- 服务器 `/opt/smart-chat/.deploy/image.env` 里是刚才的 `sha-...`
- `./scripts/prod-compose.sh --profile worker ps` 里 web/worker/caddy 为 running，镜像名为 `ghcr.io/saxon-y/smart-chat:sha-...`
- 公网 HTTPS 仍可登录、发消息、Agent 回复

如果公网检查因服务器访问自己的公网 IP 失败（hairpin NAT），把 Environment 变量 `PUBLIC_HOST` 配好，让 GitHub Runner 做公网检查；服务器侧可在应急时用 `SKIP_PUBLIC_HTTPS=1`，不要作为默认。

## 11. 切过去之后怎么发版、怎么回滚

以后正常发版：

1. 改动进入 `main`
2. 等 **CI** 和 **Publish image** 变绿
3. 再手动跑 **Deploy production**，填新的 `sha-...`
4. 点审批

服务器应急（SSH 上直接发）：

```bash
cd /opt/smart-chat
make deploy-image TAG=sha-a1b2c3d4e5f6
```

回滚到上一次成功镜像（**只有数据库 schema 仍兼容旧镜像时才能这样做**）：

```bash
make rollback-image
```

或：

```bash
SKIP_MIGRATE=1 ./scripts/deploy-image.sh sha-上一版
```

查看状态和日志：

```bash
make prod-status
make prod-logs
```

应急本地重建（会在生产机构建，只在 GHCR 不可用时用）：

```bash
ALLOW_LOCAL_BUILD_REDEPLOY=1 make redeploy
```

## 12. 建议稍后做、但不是第一次切换的阻塞项

- 给 `main` 加规则：Required check 选 `lint-typecheck-test-build`，避免没过 CI 的 commit 直接进 `main`
- 演练一次 migration 失败（备份在、应用容器没被换成坏版本）
- 演练一次 `make rollback-image`
- CI 变绿后的自动部署先不要开；至少成功完成一次手动发布、一次回滚观察后再说

## 13. 我这边已经改好的内容

- CI：PR 和 `main` 都会跑测试与生产构建
- 镜像发布：`main` 的 CI 成功后推 `sha-<12位>`、`sha-<完整>`，并打 `main` 标签
- 生产部署 workflow：只接受手动输入的 SHA/版本标签，走 `production` Environment 审批和 SSH
- `compose.production.yaml`：去掉 `build`，Web/Worker/Runtime 使用同一 GHCR 标签
- `scripts/deploy-image.sh`：备份、拉镜像、migrate、健康检查、写 `.deploy/image.env`
- `scripts/redeploy.sh`：一旦存在 `.deploy/image.env` 就拒绝再本地构建

## 14. 出问题时先看哪里

| 现象 | 先查 |
|---|---|
| CI 红 | Actions 日志；本地 `npm test` / `npm run build` |
| Publish image 403 | 第 2 步 Workflow permissions 是否 Read and write |
| 服务器 `docker pull` 401 | 第 6 步是否用 `deploy` 用户登录了 GHCR |
| Deploy 卡在审批 | Environment 是否配置了 Required reviewers，以及你是否点了 Approve |
| SSH 失败 | 公钥是否在 `authorized_keys`，Host Key 是否完整，安全组是否放行 GitHub Actions IP（或至少放行 22 来自 `0.0.0.0/0` 以外的固定策略） |
| migrate 失败 | `backups/` 里刚生成的 SQL；不要回滚数据库，先看失败的 migration |
| 新容器不健康 | `make prod-logs`；旧镜像标签在 `.deploy/previous.env` |

GitHub Actions 的出口 IP 不固定。若 22 端口目前只放行你的家宽 IP，部署 SSH 会失败。可选做法：临时把 22 放行给 GitHub，或改成允许 Actions IP 段，或先在服务器上手动跑 `make deploy-image`，SSH 自动化留到安全组策略准备好再开。
