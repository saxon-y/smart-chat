# 发布门禁

## I01 核心聊天 E2E

`tests/e2e/chat-core.spec.ts` 使用 Playwright 验证房间入口可加载，并在提供隔离种子（`E2E_EMAIL`、`E2E_PASSWORD`、`E2E_ROOM_ID`）时执行登录、发消息主旅程。通过 `E2E_BASE_URL` 指向受控 stub 环境；禁止调用收费模型。失败保留 trace，桌面/移动项目分别截图。

## I02 视觉基线

桌面 1440x900 与移动 390x844 运行同一 E2E 项目并保存截图：

```sh
npx playwright test --project=chromium --update-snapshots
```

评审要求：关键聊天列表、输入区、引用/线程入口在两种视口无重叠或溢出。

## I03 容量

固定数据容量脚本：`RUNTIME_BENCH_CONCURRENCY=100 npm run runtime:capacity`。门禁要求 uniqueClaims 等于 concurrency，claim p95 < 3s，cancel p95 < 2s。

## I04 安全矩阵

`npm run security:gate` 执行 secret 扫描及 loopback/云元数据 URL 复核。IDOR/CSRF/XSS/SSRF/上传限制由 API 测试与 provider URL policy 覆盖；新增端点必须补充未授权、跨房间、恶意正文和超限附件用例。
