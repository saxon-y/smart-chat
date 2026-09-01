# ADR-001：Agent Runtime 职责与持久化边界

日期：2026-09-01
状态：已接受

## Context

Smart Chat 当前在 Next.js/Worker 路径中直接 claim `AiRun`、调用模型并提交聊天室消息。该实现适合单轮文本与图片生成，但无法稳定支持多轮工具调用、人工审批、长任务、崩溃恢复、外部 CLI Runtime 和可审计副作用。

系统需要一条既能承载自建 Agent Loop，也能兼容未来 Codex、Claude Code 等外部 Runtime 的统一执行边界。

## Decision

1. Smart Chat Harness 是控制面，决定任务目标、上下文、Skill、工具权限、预算、Runtime 选择和结果投影。
2. Runtime 是执行面，负责逐轮调用模型与工具，以及暂停、恢复、取消和结束执行。
3. 自建 Runtime 使用独立 Node.js Worker，不在 Next.js API 请求生命周期内运行长 Agent Loop。
4. PostgreSQL 是 Run、Turn、Event、Tool Call、Approval 和 Checkpoint 的唯一事实来源；队列、WebSocket 和通知仅用于唤醒。
5. 执行恢复以完整提交的 Turn 和 Tool Result 为边界，不承诺从中断的 Provider HTTP 流偏移续传。
6. 模型和 MCP 只能提出动作，Harness Policy Engine 是权限来源。
7. 普通自建 Runtime 不提供任意 Shell、Git 或宿主文件系统能力。代码执行必须进入独立的容器化 `CODE_RUNTIME` 安全域。
8. 自建 Runtime 与外部 CLI Runtime 共用版本化 `TaskEnvelope`、`RunEvent`、`RunResult` 和父子 Run 协议。

## Drivers

- Worker 或进程崩溃后能够恢复，并避免重复消息和副作用。
- 每次执行能够追溯到固定 Agent、Context、Skill、MCP、Policy 和 Runtime 版本。
- 工具审批、权限撤销和预算限制不依赖模型或 Provider 的实现。
- 聊天业务不绑定任何单一模型或 CLI Runtime。
- 首个版本可在不承担通用编码沙箱成本的情况下交付。

## Alternatives Considered

### 继续在 Next.js API 内执行

拒绝。长任务会受请求时限、部署重启和进程资源影响，且难以表达审批等待和可靠 checkpoint。

### 将消息队列作为唯一状态来源

拒绝。队列通常提供至少一次投递，可能重复或漏失通知，不适合独立承担审计、租约和副作用幂等语义。

### 完全依赖外部 Agent CLI

拒绝作为唯一方案。外部 CLI 适合编码任务，但对聊天、图片和业务工具场景启动成本高，事件、审批和恢复能力受第三方协议限制。它仍作为可插拔 Runtime 保留。

### 第一阶段直接建设通用 Shell Agent

拒绝。宿主文件、进程、Git、网络和容器隔离扩大了安全范围，且不是聊天与业务 Agent 首发的必要条件。

## Consequences

### Positive

- Run 可在 Worker 间迁移，并从确定的持久化边界恢复。
- 自建与外部 Runtime 可以共享控制面、权限和审计。
- Tool/MCP 副作用拥有统一幂等与结果未知处理。
- 可以按房间、Agent 或 Runtime 灰度迁移。

### Negative

- 需要新增 Turn、Event、Checkpoint、Tool Call 和 Approval 数据模型。
- 流式 delta 会增加数据库写入压力，需要聚合和保留策略。
- Legacy 与新 Runtime 并存期间需要 feature flag 和兼容 facade。
- 请求级精确续传不可保证，必须披露 `REBUILT` 或 continuity gap。

## Constraints

- Provider/MCP secret、Cookie 和管理员凭据不得进入任务包、模型上下文、事件或 Artifact。
- 非幂等写操作结果未知时必须停止自动执行。
- 同一 `AiRun` 不得同时进入 Legacy 和新 Runtime 产生副作用。
- Runtime capability、策略和 Bundle digest 必须在执行前校验。

## Follow-ups

- 按 `docs/AGENT_HARNESS_RUNTIME_TASKS.md` 的 B、C、D Epic 建立协议、数据模型与控制面。
- 在自建 Runtime 首版稳定后评估外部 CLI Daemon 和独立 `CODE_RUNTIME`。
- 通过故障演练验证 Worker crash、租约丢失、重复事件和未知副作用路径。

## References

- `docs/AGENT_HARNESS_DESIGN.md`
- `docs/SELF_HOSTED_AGENT_RUNTIME_DESIGN.md`
- `docs/AGENT_HARNESS_RUNTIME_TASKS.md`
