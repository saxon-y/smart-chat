# Smart Chat

Smart Chat 是可自托管的多人实时聊天室。人和 Agent 同房间协作：注册登录、公开房间、结构化 `@` 提及、Supervisor 分流、文字与图片生成。模型密钥只留在服务端。

现网基于 Next.js 16、React 19、Prisma 6、PostgreSQL，已可本地启动。Harness 与自建 Agent Runtime 正在把「单次 chat/completions」演进为可恢复、可审批、可核验的控制面 + 执行面。

## 文档地图

面向阅读的三份总览（含产品 / 技术 / Runtime 出图）：

- [产品功能](PRODUCT_FEATURES.md)
- [技术架构](TECHNICAL_ARCHITECTURE.md)
- [AI 运行时架构](AI_RUNTIME_ARCHITECTURE.md)

设计与实施原文：

- [产品需求](PRD.md)
- [技术与实施方案](IMPLEMENTATION_PLAN.md)
- [测试规格](TEST_SPEC.md)
- [Agent Harness 设计](AGENT_HARNESS_DESIGN.md)
- [自建 Agent Runtime 设计](SELF_HOSTED_AGENT_RUNTIME_DESIGN.md)
- [ADR-001 Runtime 边界](adr/ADR-001-agent-runtime-boundary.md)

## 本地启动

见仓库根目录 [README.md](../README.md)。
